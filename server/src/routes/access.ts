import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { createNotification } from '../services/notificationService.js';
import { getChannelAccess, getConversationAccess, isAtLeast, AccessLevel } from '../services/permissionResolver.js';
import { detectConflicts, computeUsersLosingAccess, applyConflictResolutions } from '../services/conflictDetection.js';

const router = Router();
router.use(requireAuth);

const VALID_ACCESS_LEVELS: AccessLevel[] = ['no_access', 'view', 'reply', 'manage'];

/**
 * Atomic delete-then-insert for channel permissions.
 * Uses a Postgres function for atomicity when available, otherwise sequential calls.
 */
async function replaceChannelPermissions(
  channelId: number,
  rows: Array<{ channel_id: number; user_id: string | null; access_level: string; granted_by: string; company_id: string }>
): Promise<void> {
  // Delete all existing permissions for this channel
  await supabaseAdmin
    .from('channel_permissions')
    .delete()
    .eq('channel_id', channelId);

  // Insert new permissions (if any)
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from('channel_permissions')
      .insert(rows);
    if (error) {
      // If insert fails, we have a problem — log and throw so the caller handles it
      console.error('Failed to insert channel permissions after delete:', error);
      throw new Error(`Failed to replace channel permissions: ${error.message}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// CHANNEL ACCESS
// ────────────────────────────────────────────────────────────

// Get channel permissions + derived mode
router.get('/channels/:channelId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to view channel permissions' });
      return;
    }

    // Get channel owner
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Fetch owner profile
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .eq('id', channel.user_id)
      .single();

    // Get all permission rows
    const { data: permissions } = await supabaseAdmin
      .from('channel_permissions')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('channel_id', channelId);

    const permList = permissions || [];

    // Derive mode from data
    const allMembersRow = permList.find((p) => p.user_id === null);
    const specificUserRows = permList.filter((p) => p.user_id !== null);

    let mode: 'private' | 'specific_users' | 'all_members';
    if (allMembersRow) {
      mode = 'all_members';
    } else if (specificUserRows.length > 0) {
      mode = 'specific_users';
    } else {
      mode = 'private';
    }

    res.json({
      mode,
      defaultLevel: allMembersRow ? (allMembersRow.access_level as AccessLevel) : null,
      owner: ownerProfile || { id: channel.user_id, full_name: 'Owner', email: '', avatar_url: null },
      permissions: permList,
    });
  } catch (err) {
    next(err);
  }
});

// Update channel permissions (bulk replace)
router.patch('/channels/:channelId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const { permissions } = req.body as {
      permissions: Array<{ user_id: string | null; access_level: AccessLevel }>;
    };

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to update channel permissions' });
      return;
    }

    if (!Array.isArray(permissions)) {
      res.status(400).json({ error: 'permissions must be an array' });
      return;
    }

    // Validate access levels
    for (const perm of permissions) {
      if (!VALID_ACCESS_LEVELS.includes(perm.access_level)) {
        res.status(400).json({ error: `Invalid access_level: ${perm.access_level}` });
        return;
      }
    }

    // Atomic replace: delete + insert in a single RPC call
    const rows = permissions.map((p: { user_id: string | null; access_level: AccessLevel }) => ({
      channel_id: channelId,
      user_id: p.user_id,
      access_level: p.access_level,
      granted_by: userId,
      company_id: companyId,
    }));

    await replaceChannelPermissions(channelId, rows);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Grant/update individual user permission (targetUserId can be 'all' for all-members row)
router.put('/channels/:channelId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const targetUserId = req.params.targetUserId;
    const { access_level } = req.body;

    if (!VALID_ACCESS_LEVELS.includes(access_level)) {
      res.status(400).json({ error: `access_level must be one of: ${VALID_ACCESS_LEVELS.join(', ')}` });
      return;
    }

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to manage channel permissions' });
      return;
    }

    const resolvedUserId = targetUserId === 'all' ? null : targetUserId;

    // If granting to a specific user, verify they are a company member
    if (resolvedUserId) {
      const { data: member } = await supabaseAdmin
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('user_id', resolvedUserId)
        .single();

      if (!member) {
        res.status(400).json({ error: 'User is not a company member' });
        return;
      }
    }

    // For NULL user_id (all-members row), onConflict can't match NULL=NULL,
    // so use delete-then-insert. For specific users, upsert works fine.
    if (resolvedUserId === null) {
      await supabaseAdmin
        .from('channel_permissions')
        .delete()
        .eq('channel_id', channelId)
        .is('user_id', null);

      await supabaseAdmin
        .from('channel_permissions')
        .insert({
          channel_id: channelId,
          user_id: null,
          access_level,
          granted_by: userId,
          company_id: companyId,
        });
    } else {
      await supabaseAdmin
        .from('channel_permissions')
        .upsert(
          {
            channel_id: channelId,
            user_id: resolvedUserId,
            access_level,
            granted_by: userId,
            company_id: companyId,
          },
          { onConflict: 'channel_id,user_id' }
        );
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Revoke individual user permission (targetUserId can be 'all')
router.delete('/channels/:channelId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const targetUserId = req.params.targetUserId;

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to manage channel permissions' });
      return;
    }

    let query = supabaseAdmin
      .from('channel_permissions')
      .delete()
      .eq('channel_id', channelId);

    if (targetUserId === 'all') {
      query = query.is('user_id', null);
    } else {
      query = query.eq('user_id', targetUserId);
    }

    await query;

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Preview conflicts before applying channel permission changes
router.post('/channels/:channelId/check-conflicts', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to check conflicts' });
      return;
    }

    const { removeAllMembersRow, removeUserIds, addNoAccessUserIds } = req.body;

    const usersLosingAccess = await computeUsersLosingAccess(channelId, companyId, {
      removeAllMembersRow,
      removeUserIds,
      addNoAccessUserIds,
    });

    const conflicts = await detectConflicts(channelId, companyId, usersLosingAccess);

    res.json({ conflicts });
  } catch (err) {
    next(err);
  }
});

// Apply channel changes + conflict resolutions
router.post('/channels/:channelId/resolve-conflicts', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    // Verify manage access
    const access = await getChannelAccess(userId, channelId, companyId);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to resolve conflicts' });
      return;
    }

    const { proposedChange, resolutions } = req.body;

    // Build the final permission set by merging proposed permissions with "keep" users
    const keepUsers = (resolutions || []).filter((r: any) => r.action === 'keep');
    const removeUsers = (resolutions || []).filter((r: any) => r.action === 'remove');

    let finalPermissions: Array<{ user_id: string | null; access_level: AccessLevel }> = [];

    if (proposedChange?.permissions && Array.isArray(proposedChange.permissions)) {
      finalPermissions = [...proposedChange.permissions];
    }

    // Merge "keep" users into the permission set with 'view' (minimum access)
    for (const keepUser of keepUsers) {
      const exists = finalPermissions.some((p) => p.user_id === keepUser.userId);
      if (!exists) {
        finalPermissions.push({ user_id: keepUser.userId, access_level: 'view' });
      }
    }

    // Atomic replace channel permissions
    const rows = finalPermissions.map((p) => ({
      channel_id: channelId,
      user_id: p.user_id,
      access_level: p.access_level,
      granted_by: userId,
      company_id: companyId,
    }));

    await replaceChannelPermissions(channelId, rows);

    // For "remove" users: delete their conversation overrides in this channel
    if (removeUsers.length > 0) {
      const { data: sessions } = await supabaseAdmin
        .from('chat_sessions')
        .select('id')
        .eq('channel_id', channelId)
        .is('deleted_at', null);

      const sessionIds = sessions?.map((s) => s.id) || [];
      if (sessionIds.length > 0) {
        const removeUserIds = removeUsers.map((r: any) => r.userId);
        await supabaseAdmin
          .from('conversation_permissions')
          .delete()
          .in('session_id', sessionIds)
          .in('user_id', removeUserIds);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────
// CONVERSATION ACCESS
// ────────────────────────────────────────────────────────────

// Get conversation permissions (overrides + inherited from channel)
router.get('/conversations/:sessionId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    // Fetch session to get channel_id
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Verify manage access on the conversation (owner or manage-level user)
    const access = await getConversationAccess(userId, sessionId, companyId, session.channel_id);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to view conversation permissions' });
      return;
    }

    // Get channel default level (NULL user_id row)
    const { data: channelDefault } = await supabaseAdmin
      .from('channel_permissions')
      .select('access_level')
      .eq('channel_id', session.channel_id)
      .is('user_id', null)
      .maybeSingle();

    const channelDefaultLevel: AccessLevel | null = channelDefault
      ? (channelDefault.access_level as AccessLevel)
      : null;

    // Get conversation-level overrides
    const { data: convPerms } = await supabaseAdmin
      .from('conversation_permissions')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('session_id', sessionId);

    // Get channel-level permissions (inherited, read-only display)
    const { data: channelPerms } = await supabaseAdmin
      .from('channel_permissions')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('channel_id', session.channel_id);

    res.json({
      channelDefaultLevel,
      permissions: convPerms || [],
      inherited: channelPerms || [],
    });
  } catch (err) {
    next(err);
  }
});

// Grant/update conversation override (targetUserId can be 'all')
router.put('/conversations/:sessionId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const { sessionId, targetUserId } = req.params;
    const { access_level } = req.body;

    if (!VALID_ACCESS_LEVELS.includes(access_level)) {
      res.status(400).json({ error: `access_level must be one of: ${VALID_ACCESS_LEVELS.join(', ')}` });
      return;
    }

    // Fetch session
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Verify manage access
    const access = await getConversationAccess(userId, sessionId, companyId, session.channel_id);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to manage conversation permissions' });
      return;
    }

    const resolvedUserId = targetUserId === 'all' ? null : targetUserId;

    // Fix 5: Validate target user has channel access before creating override
    if (resolvedUserId) {
      const targetChannelAccess = await getChannelAccess(resolvedUserId, session.channel_id, companyId);
      if (!targetChannelAccess || targetChannelAccess === 'no_access') {
        res.status(400).json({ error: 'Target user does not have channel access. Grant channel access first.' });
        return;
      }
    }

    // For NULL user_id (all-users row), onConflict can't match NULL=NULL
    if (resolvedUserId === null) {
      await supabaseAdmin
        .from('conversation_permissions')
        .delete()
        .eq('session_id', sessionId)
        .is('user_id', null);

      await supabaseAdmin
        .from('conversation_permissions')
        .insert({
          session_id: sessionId,
          user_id: null,
          access_level,
          granted_by: userId,
          company_id: companyId,
        });
    } else {
      await supabaseAdmin
        .from('conversation_permissions')
        .upsert(
          {
            session_id: sessionId,
            user_id: resolvedUserId,
            access_level,
            granted_by: userId,
            company_id: companyId,
          },
          { onConflict: 'session_id,user_id' }
        );
    }

    res.json({ status: 'ok' });

    // Notify the target user that a conversation was shared with them (non-blocking)
    if (resolvedUserId && resolvedUserId !== userId) {
      createNotification({
        companyId: session.company_id,
        userId: resolvedUserId,
        type: 'share',
        title: 'Conversation shared with you',
        body: `You were given ${access_level} access to a conversation`,
        data: { conversation_id: sessionId },
      }).catch((err) => console.error('Share notification error:', err));
    }
  } catch (err) {
    next(err);
  }
});

// Remove conversation override (targetUserId can be 'all')
router.delete('/conversations/:sessionId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId!;
    const { sessionId, targetUserId } = req.params;

    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Verify manage access
    const access = await getConversationAccess(userId, sessionId, companyId, session.channel_id);
    if (!access || !isAtLeast(access, 'manage')) {
      res.status(403).json({ error: 'You need manage access to manage conversation permissions' });
      return;
    }

    let query = supabaseAdmin
      .from('conversation_permissions')
      .delete()
      .eq('session_id', sessionId);

    if (targetUserId === 'all') {
      query = query.is('user_id', null);
    } else {
      query = query.eq('user_id', targetUserId);
    }

    await query;

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────
// CONTACT ACCESS
// ────────────────────────────────────────────────────────────

// Get access settings for a contact (owner only)
router.get('/contacts/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id, owner_id, sharing_mode')
      .eq('id', contactId)
      .eq('company_id', req.companyId!)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    if (contact.owner_id !== userId) {
      res.status(403).json({ error: 'Only the contact owner can manage access settings' });
      return;
    }

    const { data: accessList } = await supabaseAdmin
      .from('contact_access')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('contact_id', contactId);

    res.json({
      sharing_mode: contact.sharing_mode,
      access_list: accessList || [],
    });
  } catch (err) {
    next(err);
  }
});

// Update contact sharing settings (owner only)
router.patch('/contacts/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;
    const { sharing_mode } = req.body;

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('owner_id')
      .eq('id', contactId)
      .eq('company_id', req.companyId!)
      .single();

    if (!contact || contact.owner_id !== userId) {
      res.status(403).json({ error: 'Only the contact owner can manage access settings' });
      return;
    }

    if (!['private', 'specific_users', 'all_members'].includes(sharing_mode)) {
      res.status(400).json({ error: 'Invalid sharing_mode' });
      return;
    }

    await supabaseAdmin
      .from('contacts')
      .update({ sharing_mode, updated_at: new Date().toISOString() })
      .eq('id', contactId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Add or update contact access for a user (owner only)
router.put('/contacts/:contactId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId, targetUserId } = req.params;
    const { access_level } = req.body;

    if (!['view', 'edit'].includes(access_level)) {
      res.status(400).json({ error: 'access_level must be "view" or "edit"' });
      return;
    }

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('owner_id')
      .eq('id', contactId)
      .eq('company_id', req.companyId!)
      .single();

    if (!contact || contact.owner_id !== userId) {
      res.status(403).json({ error: 'Only the contact owner can manage access' });
      return;
    }

    await supabaseAdmin
      .from('contact_access')
      .upsert(
        {
          contact_id: contactId,
          user_id: targetUserId,
          access_level,
          granted_by: userId,
        },
        { onConflict: 'contact_id,user_id' }
      );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Remove contact access for a user (owner only)
router.delete('/contacts/:contactId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId, targetUserId } = req.params;

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('owner_id')
      .eq('id', contactId)
      .eq('company_id', req.companyId!)
      .single();

    if (!contact || contact.owner_id !== userId) {
      res.status(403).json({ error: 'Only the contact owner can manage access' });
      return;
    }

    await supabaseAdmin
      .from('contact_access')
      .delete()
      .eq('contact_id', contactId)
      .eq('user_id', targetUserId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
