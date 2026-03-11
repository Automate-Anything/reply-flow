import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────────────────
// CHANNEL ACCESS
// ────────────────────────────────────────────────────────────

// Get access settings for a channel (owner only)
router.get('/channels/:channelId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const channelId = Number(req.params.channelId);

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, user_id, sharing_mode, default_conversation_visibility, company_id')
      .eq('id', channelId)
      .eq('company_id', req.companyId!)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    if (channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage access settings' });
      return;
    }

    // Get access list (exclude owner — shown separately)
    const { data: accessList } = await supabaseAdmin
      .from('channel_access')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('channel_id', channelId)
      .neq('user_id', channel.user_id);

    // Fetch owner profile
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .eq('id', channel.user_id)
      .single();

    res.json({
      sharing_mode: channel.sharing_mode,
      default_conversation_visibility: channel.default_conversation_visibility,
      owner: ownerProfile || { id: channel.user_id, full_name: 'Owner', email: '', avatar_url: null },
      access_list: accessList || [],
    });
  } catch (err) {
    next(err);
  }
});

// Update channel sharing settings (owner only)
router.patch('/channels/:channelId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const channelId = Number(req.params.channelId);
    const { sharing_mode, default_conversation_visibility } = req.body;

    // Verify ownership
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .eq('company_id', req.companyId!)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    if (channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage access settings' });
      return;
    }

    const updates: Record<string, unknown> = {};

    if (sharing_mode !== undefined) {
      if (!['private', 'specific_users', 'all_members'].includes(sharing_mode)) {
        res.status(400).json({ error: 'Invalid sharing_mode' });
        return;
      }
      updates.sharing_mode = sharing_mode;
    }

    if (default_conversation_visibility !== undefined) {
      if (!['all', 'owner_only'].includes(default_conversation_visibility)) {
        res.status(400).json({ error: 'Invalid default_conversation_visibility' });
        return;
      }
      updates.default_conversation_visibility = default_conversation_visibility;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabaseAdmin
        .from('whatsapp_channels')
        .update(updates)
        .eq('id', channelId);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Add or update channel access for a user (owner only)
router.put('/channels/:channelId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const channelId = Number(req.params.channelId);
    const targetUserId = req.params.targetUserId;
    const { access_level } = req.body;

    if (!['view', 'edit'].includes(access_level)) {
      res.status(400).json({ error: 'access_level must be "view" or "edit"' });
      return;
    }

    // Verify ownership
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .eq('company_id', req.companyId!)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    if (channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage access' });
      return;
    }

    // Verify target user is a company member
    const { data: member } = await supabaseAdmin
      .from('company_members')
      .select('user_id')
      .eq('company_id', req.companyId!)
      .eq('user_id', targetUserId)
      .single();

    if (!member) {
      res.status(400).json({ error: 'User is not a company member' });
      return;
    }

    // Upsert access
    await supabaseAdmin
      .from('channel_access')
      .upsert(
        {
          channel_id: channelId,
          user_id: targetUserId,
          access_level,
          granted_by: userId,
        },
        { onConflict: 'channel_id,user_id' }
      );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Remove channel access for a user (owner only)
router.delete('/channels/:channelId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const channelId = Number(req.params.channelId);
    const targetUserId = req.params.targetUserId;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .eq('company_id', req.companyId!)
      .single();

    if (!channel || channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage access' });
      return;
    }

    await supabaseAdmin
      .from('channel_access')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', targetUserId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────
// CONVERSATION ACCESS
// ────────────────────────────────────────────────────────────

// Get access list for a conversation
router.get('/conversations/:sessionId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { sessionId } = req.params;

    // Fetch session + channel to verify ownership
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', req.companyId!)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id, default_conversation_visibility')
      .eq('id', session.channel_id)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Only channel owner can manage conversation access
    if (channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage conversation access' });
      return;
    }

    const { data: accessList } = await supabaseAdmin
      .from('conversation_access')
      .select('id, user_id, access_level, created_at, user:user_id(id, full_name, email, avatar_url)')
      .eq('session_id', sessionId);

    res.json({
      default_conversation_visibility: channel.default_conversation_visibility,
      access_list: accessList || [],
    });
  } catch (err) {
    next(err);
  }
});

// Grant conversation access to a user (or all via user_id=null)
router.put('/conversations/:sessionId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { sessionId, targetUserId } = req.params;
    const { access_level } = req.body;

    if (!['view', 'edit'].includes(access_level)) {
      res.status(400).json({ error: 'access_level must be "view" or "edit"' });
      return;
    }

    // Verify channel ownership
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', req.companyId!)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', session.channel_id)
      .single();

    if (!channel || channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage conversation access' });
      return;
    }

    const resolvedUserId = targetUserId === 'all' ? null : targetUserId;

    await supabaseAdmin
      .from('conversation_access')
      .upsert(
        {
          session_id: sessionId,
          user_id: resolvedUserId,
          access_level,
          granted_by: userId,
        },
        { onConflict: 'session_id,user_id' }
      );

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Remove conversation access for a user
router.delete('/conversations/:sessionId/users/:targetUserId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { sessionId, targetUserId } = req.params;

    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id, company_id')
      .eq('id', sessionId)
      .eq('company_id', req.companyId!)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', session.channel_id)
      .single();

    if (!channel || channel.user_id !== userId) {
      res.status(403).json({ error: 'Only the channel owner can manage conversation access' });
      return;
    }

    let query = supabaseAdmin
      .from('conversation_access')
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
