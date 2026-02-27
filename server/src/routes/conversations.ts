import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List conversations with optional search/filter
router.get('/', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      search,
      status,
      archived,
      channelId,
      workspaceId,
      assignee,
      priority,
      starred,
      snoozed,
      labelId,
      sort = 'newest',
      limit = '50',
      offset = '0',
    } = req.query;

    let query = supabaseAdmin
      .from('chat_sessions')
      .select(
        '*, conversation_labels(label_id, labels(id, name, color)), assigned_user:assigned_to(id, full_name, avatar_url)'
      )
      .eq('company_id', companyId)
      .is('deleted_at', null);

    // Workspace filtering: only show conversations from channels in this workspace
    if (workspaceId) {
      const { data: wsChannels } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('company_id', companyId);
      const wsChannelIds = (wsChannels || []).map((c) => c.id);
      if (wsChannelIds.length === 0) {
        res.json({ sessions: [], count: 0 });
        return;
      }
      query = query.in('channel_id', wsChannelIds);
    }

    // Archived filter
    if (archived === 'true') {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    // Status filter
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Channel filter
    if (channelId) {
      query = query.eq('channel_id', Number(channelId));
    }

    // Assignee filter
    if (assignee === 'me') {
      query = query.eq('assigned_to', req.userId);
    } else if (assignee === 'unassigned') {
      query = query.is('assigned_to', null);
    } else if (assignee && assignee !== 'all') {
      query = query.eq('assigned_to', String(assignee));
    }

    // Priority filter
    if (priority && priority !== 'all') {
      query = query.eq('priority', String(priority));
    }

    // Starred filter
    if (starred === 'true') {
      query = query.eq('is_starred', true);
    }

    // Label filter
    if (labelId) {
      const { data: labelSessions } = await supabaseAdmin
        .from('conversation_labels')
        .select('session_id')
        .eq('label_id', String(labelId));
      const labelSessionIds = (labelSessions || []).map((ls) => ls.session_id);
      if (labelSessionIds.length === 0) {
        res.json({ sessions: [], count: 0 });
        return;
      }
      query = query.in('id', labelSessionIds);
    }

    // Snoozed filter: by default hide snoozed, unless explicitly requesting them
    if (snoozed === 'true') {
      query = query.not('snoozed_until', 'is', null).gt('snoozed_until', new Date().toISOString());
    } else {
      query = query.or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    }

    // Search
    if (search) {
      query = query.or(
        `contact_name.ilike.%${search}%,phone_number.ilike.%${search}%,last_message.ilike.%${search}%`
      );
    }

    // Sort
    if (sort === 'oldest') {
      query = query.order('last_message_at', { ascending: true, nullsFirst: false });
    } else {
      query = query.order('last_message_at', { ascending: false, nullsFirst: false });
    }

    // Pagination
    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    // Get unread counts for each session
    const sessionIds = (data || []).map((s) => s.id);
    let unreadMap: Record<string, number> = {};

    if (sessionIds.length > 0) {
      const { data: unreadCounts } = await supabaseAdmin
        .from('chat_messages')
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('direction', 'inbound')
        .eq('read', false);

      if (unreadCounts) {
        for (const row of unreadCounts) {
          unreadMap[row.session_id] = (unreadMap[row.session_id] || 0) + 1;
        }
      }
    }

    const sessions = (data || []).map((s) => ({
      ...s,
      unread_count: unreadMap[s.id] || 0,
      labels:
        s.conversation_labels
          ?.map((cl: Record<string, Record<string, unknown>>) => cl.labels)
          .filter(Boolean) || [],
      assigned_user: s.assigned_user || null,
    }));

    res.json({ sessions, count });
  } catch (err) {
    next(err);
  }
});

// Get messages for a conversation (cursor pagination)
router.get('/:sessionId/messages', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;
    const { before, limit = '50' } = req.query;

    // Verify session belongs to user
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    // Return in chronological order
    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    next(err);
  }
});

// Mark messages as read
router.post('/:sessionId/read', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    // Verify ownership
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await supabaseAdmin
      .from('chat_messages')
      .update({ read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('read', false);

    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_read_at: new Date().toISOString(),
        marked_unread: false,
      })
      .eq('id', sessionId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Archive / unarchive a conversation
router.post('/:sessionId/archive', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;
    const { archived } = req.body;

    await supabaseAdmin
      .from('chat_sessions')
      .update({
        is_archived: archived ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Update conversation properties (status, assigned_to, priority, is_starred, snoozed_until)
router.patch('/:sessionId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;
    const { status, assigned_to, priority, is_starred, snoozed_until } = req.body;

    // Verify session belongs to company
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (status !== undefined) {
      const validStatuses = ['open', 'pending', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      updates.status = status;
    }

    if (assigned_to !== undefined) {
      if (assigned_to !== null) {
        const { data: member } = await supabaseAdmin
          .from('company_members')
          .select('user_id')
          .eq('company_id', companyId)
          .eq('user_id', assigned_to)
          .single();
        if (!member) {
          res.status(400).json({ error: 'Assigned user is not a company member' });
          return;
        }
      }
      updates.assigned_to = assigned_to;
    }

    if (priority !== undefined) {
      const validPriorities = ['none', 'low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        res.status(400).json({ error: 'Invalid priority' });
        return;
      }
      updates.priority = priority;
    }

    if (is_starred !== undefined) {
      updates.is_starred = !!is_starred;
    }

    if (snoozed_until !== undefined) {
      updates.snoozed_until = snoozed_until;
    }

    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .select(
        '*, conversation_labels(label_id, labels(id, name, color)), assigned_user:assigned_to(id, full_name, avatar_url)'
      )
      .single();

    if (error) throw error;

    const result = {
      ...data,
      labels:
        data.conversation_labels
          ?.map((cl: Record<string, Record<string, unknown>>) => cl.labels)
          .filter(Boolean) || [],
      assigned_user: data.assigned_user || null,
    };

    res.json({ session: result });
  } catch (err) {
    next(err);
  }
});

// Bulk update conversations — must be registered before /:sessionId routes
router.post('/bulk', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionIds, action, value } = req.body;

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ error: 'sessionIds array is required' });
      return;
    }

    if (sessionIds.length > 100) {
      res.status(400).json({ error: 'Maximum 100 conversations per bulk operation' });
      return;
    }

    // Verify all sessions belong to company
    const { data: validSessions } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .in('id', sessionIds)
      .eq('company_id', companyId);

    const validIds = (validSessions || []).map((s) => s.id);
    if (validIds.length === 0) {
      res.status(404).json({ error: 'No valid sessions found' });
      return;
    }

    switch (action) {
      case 'assign':
        await supabaseAdmin
          .from('chat_sessions')
          .update({ assigned_to: value, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      case 'status': {
        const validStatuses = ['open', 'pending', 'resolved', 'closed'];
        if (!validStatuses.includes(value)) {
          res.status(400).json({ error: 'Invalid status' });
          return;
        }
        await supabaseAdmin
          .from('chat_sessions')
          .update({ status: value, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      }
      case 'priority': {
        const validPriorities = ['none', 'low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(value)) {
          res.status(400).json({ error: 'Invalid priority' });
          return;
        }
        await supabaseAdmin
          .from('chat_sessions')
          .update({ priority: value, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      }
      case 'archive':
        await supabaseAdmin
          .from('chat_sessions')
          .update({ is_archived: value ?? true, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      case 'star':
        await supabaseAdmin
          .from('chat_sessions')
          .update({ is_starred: value ?? true, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      case 'label_add': {
        const labelInserts = validIds.map((sid) => ({ session_id: sid, label_id: value }));
        await supabaseAdmin.from('conversation_labels').upsert(labelInserts, { onConflict: 'session_id,label_id' });
        break;
      }
      case 'label_remove':
        await supabaseAdmin
          .from('conversation_labels')
          .delete()
          .in('session_id', validIds)
          .eq('label_id', value);
        break;
      default:
        res.status(400).json({ error: 'Invalid action' });
        return;
    }

    res.json({ updated: validIds.length });
  } catch (err) {
    next(err);
  }
});

export default router;
