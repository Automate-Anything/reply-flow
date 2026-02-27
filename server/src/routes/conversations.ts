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
    const { search, status, archived, channelId, workspaceId, limit = '50', offset = '0' } = req.query;

    let query = supabaseAdmin
      .from('chat_sessions')
      .select('*, conversation_labels(label_id, labels(id, name, color))')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

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

    if (archived === 'true') {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (channelId) {
      query = query.eq('channel_id', Number(channelId));
    }

    if (search) {
      query = query.or(
        `contact_name.ilike.%${search}%,phone_number.ilike.%${search}%,last_message.ilike.%${search}%`
      );
    }

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
      labels: s.conversation_labels?.map((cl: Record<string, Record<string, unknown>>) => cl.labels).filter(Boolean) || [],
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

export default router;
