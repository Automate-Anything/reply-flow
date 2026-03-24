import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { extractSessionMemories } from '../services/sessionMemory.js';
import { getAccessibleSessions, getConversationAccess, getOverrideMetadata, ensureConversationAccessOnAssign } from '../services/permissionResolver.js';
import { fetchAndStoreProfilePicture } from '../services/messageProcessor.js';
import { createNotification } from '../services/notificationService.js';

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
      assignee,
      priority,
      starred,
      snoozed,
      unread,
      labelId,
      sort = 'newest',
      limit = '50',
      offset = '0',
    } = req.query;

    // Determine which conversations this user can access
    const { filter } = await getAccessibleSessions(req.userId!, companyId);

    let query = supabaseAdmin
      .from('chat_sessions')
      .select(
        '*, contact:contact_id(profile_picture_url), conversation_labels(label_id, labels(id, name, color)), assigned_user:assigned_to(id, full_name, avatar_url), channel:channel_id(channel_type, email_address)'
      )
      .eq('company_id', companyId)
      .is('deleted_at', null);

    // Apply access-based filtering
    if (filter.mode === 'filtered') {
      if (filter.channelIds.length === 0) {
        res.json({ sessions: [], count: 0 });
        return;
      }
      query = query.in('channel_id', filter.channelIds);
      if (filter.excludedSessionIds.length > 0) {
        query = query.not('id', 'in', `(${filter.excludedSessionIds.join(',')})`);
      }
    }
    // mode === 'all' means no filtering needed

    // Archived filter
    if (archived === 'true') {
      query = query.eq('is_archived', true);
    } else {
      // Normal inbox: exclude archived AND ended sessions (ended sessions
      // are no longer auto-archived, so we filter them out explicitly).
      query = query.eq('is_archived', false).is('ended_at', null);
    }

    const statusValues = typeof status === 'string'
      ? status.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

    // Status filter
    if (statusValues.length > 0 && !statusValues.includes('all')) {
      query = query.in('status', statusValues);
    }

    // Channel filter
    if (channelId) {
      query = query.eq('channel_id', Number(channelId));
    }

    // Channel type filter (e.g. 'whatsapp' or 'email')
    if (req.query.channel_type) {
      const { data: typedChannels } = await supabaseAdmin
        .from('channels')
        .select('id')
        .eq('company_id', companyId)
        .eq('channel_type', req.query.channel_type as string);
      const typedIds = (typedChannels || []).map((c: any) => c.id);
      if (typedIds.length === 0) {
        res.json({ sessions: [], count: 0 });
        return;
      }
      query = query.in('channel_id', typedIds);
    }

    const assigneeValues = typeof assignee === 'string'
      ? assignee.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

    // Assignee filter
    if (assigneeValues.length > 0 && !assigneeValues.includes('all')) {
      const assigneeOrParts: string[] = [];
      const explicitAssigneeIds: string[] = [];

      for (const value of assigneeValues) {
        if (value === 'me') {
          assigneeOrParts.push(`assigned_to.eq.${req.userId}`);
        } else if (value === 'unassigned') {
          assigneeOrParts.push('assigned_to.is.null');
        } else if (value === 'others') {
          assigneeOrParts.push(`and(assigned_to.not.is.null,assigned_to.neq.${req.userId})`);
        } else {
          explicitAssigneeIds.push(value);
        }
      }

      if (explicitAssigneeIds.length > 0) {
        assigneeOrParts.push(`assigned_to.in.(${explicitAssigneeIds.join(',')})`);
      }

      if (assigneeOrParts.length > 0) {
        query = query.or(assigneeOrParts.join(','));
      }
    }

    const priorityValues = typeof priority === 'string'
      ? priority.split(',').map((value) => value.trim()).filter(Boolean)
      : [];

    // Priority filter
    if (priorityValues.length > 0 && !priorityValues.includes('all')) {
      query = query.in('priority', priorityValues);
    }

    // Starred filter
    if (starred === 'true') {
      query = query.eq('is_starred', true);
    }

    // Snoozed filter (at DB level for correct pagination)
    const nowIso = new Date().toISOString();
    if (snoozed === 'true') {
      // Only currently-snoozed conversations (snoozed_until is in the future)
      query = query.not('snoozed_until', 'is', null).gt('snoozed_until', nowIso);
    } else {
      // Exclude snoozed conversations from the normal view
      query = query.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`);
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

    // Search
    if (search) {
      query = query.or(
        `contact_name.ilike.%${search}%,phone_number.ilike.%${search}%,last_message.ilike.%${search}%`
      );
    }

    // Sort — pinned conversations always appear first
    query = query.order('pinned_at', { ascending: true, nullsFirst: false });

    if (sort === 'oldest') {
      query = query.order('last_message_at', { ascending: true, nullsFirst: false });
    } else {
      query = query.order('last_message_at', { ascending: false, nullsFirst: false });
    }

    // Pagination
    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error } = await query;

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

    // Message count for email threads (for badge display)
    const emailSessionIds = (data || [])
      .filter((s: any) => (s.channel as any)?.channel_type === 'email')
      .map((s: any) => s.id);
    const msgCountMap: Record<string, number> = {};
    if (emailSessionIds.length > 0) {
      const { data: msgCounts } = await supabaseAdmin
        .from('chat_messages')
        .select('session_id')
        .in('session_id', emailSessionIds);
      if (msgCounts) {
        for (const row of msgCounts) {
          msgCountMap[row.session_id] = (msgCountMap[row.session_id] || 0) + 1;
        }
      }
    }

    // Post-filter for unread: sessions with marked_unread OR actual unread messages
    let filteredData = data || [];
    if (unread === 'true') {
      filteredData = filteredData.filter(
        (s) => s.marked_unread === true || (unreadMap[s.id] || 0) > 0
      );
    }

    // Get session counts per contact for "returning contact" indicators
    const contactIds = [...new Set(filteredData.map((s) => s.contact_id).filter(Boolean))];
    let sessionCountMap: Record<string, number> = {};
    if (contactIds.length > 0) {
      const { data: countRows } = await supabaseAdmin
        .from('chat_sessions')
        .select('contact_id')
        .eq('company_id', companyId)
        .in('contact_id', contactIds)
        .is('deleted_at', null);

      if (countRows) {
        for (const row of countRows) {
          sessionCountMap[row.contact_id] = (sessionCountMap[row.contact_id] || 0) + 1;
        }
      }
    }

    // Enrich with override metadata for shield indicators
    const filteredSessionIds = (filteredData || []).map((s: any) => s.id);
    const overrideMeta = await getOverrideMetadata(filteredSessionIds, companyId);
    const metaMap = new Map(overrideMeta.map((m) => [m.sessionId, m]));
    const enrichedSessions = (filteredData || []).map((s: any) => ({
      ...s,
      override_meta: metaMap.get(s.id) || null,
    }));

    const sessions = enrichedSessions.map((s: any) => ({
        ...s,
        unread_count: unreadMap[s.id] || 0,
        contact_session_count: s.contact_id ? (sessionCountMap[s.contact_id] || 1) : 1,
        profile_picture_url: (s.contact as Record<string, unknown>)?.profile_picture_url || null,
        channel_type: (s.channel as Record<string, unknown>)?.channel_type || null,
        channel_email: (s.channel as Record<string, unknown>)?.email_address || null,
        message_count: msgCountMap[s.id] || 0,
        labels:
          s.conversation_labels
            ?.map((cl: Record<string, Record<string, unknown>>) => cl.labels)
            .filter(Boolean) || [],
        assigned_user: s.assigned_user || null,
      }));

    res.json({ sessions, count: filteredData.length });

    // Background: fetch profile pictures for contacts missing them
    const missingPics = sessions.filter(
      (s) => !s.profile_picture_url && s.contact_id && s.phone_number && s.channel_id
    );
    if (missingPics.length > 0) {
      Promise.allSettled(
        missingPics.map((s) =>
          fetchAndStoreProfilePicture(s.contact_id!, s.phone_number, s.channel_id!, companyId)
        )
      ).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

// Get connected channel types for this company (used by channel tabs in the inbox)
router.get('/channel-types', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { data } = await supabaseAdmin
      .from('channels')
      .select('channel_type')
      .eq('company_id', companyId)
      .eq('channel_status', 'connected');
    const types = [...new Set((data || []).map((c: any) => c.channel_type).filter(Boolean))];
    res.json(types);
  } catch (err) {
    next(err);
  }
});

// Get a single conversation by ID (used for notification deep-links when the
// conversation isn't in the currently-filtered list, e.g. snoozed or archived)
router.get('/:sessionId', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    const { data: session, error } = await supabaseAdmin
      .from('chat_sessions')
      .select(
        '*, contact:contact_id(profile_picture_url), conversation_labels(label_id, labels(id, name, color)), assigned_user:assigned_to(id, full_name, avatar_url), channel:channel_id(channel_type, email_address)'
      )
      .eq('id', sessionId as string)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .single();

    if (error || !session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Verify the user has access to this conversation
    const { filter } = await getAccessibleSessions(req.userId!, companyId);
    if (filter.mode === 'filtered') {
      const hasChannelAccess = filter.channelIds.includes(session.channel_id);
      const isExcluded = filter.excludedSessionIds.includes(session.id);
      if (!hasChannelAccess || isExcluded) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
    }

    // Unread count
    const { data: unreadRows } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('session_id', sessionId as string)
      .eq('direction', 'inbound')
      .eq('read', false);

    // Session count for contact
    let contactSessionCount = 1;
    if (session.contact_id) {
      const { count } = await supabaseAdmin
        .from('chat_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('contact_id', session.contact_id)
        .is('deleted_at', null);
      contactSessionCount = count || 1;
    }

    // Override metadata
    const overrideMeta = await getOverrideMetadata([sessionId as string], companyId);

    const enriched = {
      ...session,
      unread_count: unreadRows?.length || 0,
      contact_session_count: contactSessionCount,
      profile_picture_url: (session.contact as Record<string, unknown>)?.profile_picture_url || null,
      channel_type: (session.channel as Record<string, unknown>)?.channel_type || null,
      channel_email: (session.channel as Record<string, unknown>)?.email_address || null,
      labels:
        session.conversation_labels
          ?.map((cl: Record<string, Record<string, unknown>>) => cl.labels)
          .filter(Boolean) || [],
      assigned_user: session.assigned_user || null,
      override_meta: overrideMeta[0] || null,
    };

    res.json({ session: enriched });
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

    // Verify user has access to this conversation
    const convAccess = await getConversationAccess(req.userId!, sessionId as string, companyId);
    if (!convAccess || convAccess === 'no_access') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Look up the contact for this session, then fetch messages across ALL
    // sessions for that contact so the thread shows full conversation history.
    const { data: currentSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('contact_id')
      .eq('id', sessionId as string)
      .single();

    let sessionIds: string[] = [sessionId as string];
    if (currentSession?.contact_id) {
      const { data: contactSessions } = await supabaseAdmin
        .from('chat_sessions')
        .select('id')
        .eq('contact_id', currentSession.contact_id)
        .eq('company_id', companyId);
      if (contactSessions && contactSessions.length > 0) {
        sessionIds = contactSessions.map((s) => s.id);
      }
    }

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .in('session_id', sessionIds)
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

    // Verify user has access to this conversation
    const convAccess = await getConversationAccess(req.userId!, sessionId as string, companyId);
    if (!convAccess || convAccess === 'no_access') {
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
    const { status, assigned_to, priority, is_starred, snoozed_until, marked_unread, pinned_at, draft_message } = req.body;

    // Verify user has edit access to this conversation
    const convAccess = await getConversationAccess(req.userId!, sessionId as string, companyId);
    if (!convAccess || convAccess === 'no_access') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (convAccess === 'view') {
      res.status(403).json({ error: 'You have view-only access to this conversation' });
      return;
    }

    const updates: Record<string, unknown> = {};
    let sessionClosed = false;

    if (status !== undefined) {
      // Look up the status in conversation_statuses for this company
      const { data: statusRow } = await supabaseAdmin
        .from('conversation_statuses')
        .select('id, name, "group"')
        .eq('company_id', companyId)
        .eq('name', status)
        .eq('is_deleted', false)
        .single();

      if (!statusRow) {
        res.status(400).json({ error: `Invalid status: "${status}"` });
        return;
      }
      updates.status = status;

      // Session boundary based on status group
      if (statusRow.group === 'closed') {
        updates.ended_at = new Date().toISOString();
        sessionClosed = true;
      } else {
        updates.ended_at = null;
      }
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

      // Auto-grant conversation access when assigning someone
      if (assigned_to !== null) {
        ensureConversationAccessOnAssign(sessionId as string, assigned_to, req.userId!, companyId).catch((err) => {
          console.error('Failed to auto-grant conversation access on assign:', err);
        });
      }
    }

    if (priority !== undefined) {
      const normalizedPriority = String(priority).trim();
      const { data: priorityRow } = await supabaseAdmin
        .from('conversation_priorities')
        .select('id')
        .eq('company_id', companyId)
        .eq('name', normalizedPriority)
        .eq('is_deleted', false)
        .single();
      if (!priorityRow) {
        res.status(400).json({ error: 'Invalid priority' });
        return;
      }
      updates.priority = normalizedPriority;
    }

    if (is_starred !== undefined) {
      updates.is_starred = !!is_starred;
    }

    if (snoozed_until !== undefined) {
      updates.snoozed_until = snoozed_until;
    }

    if (marked_unread !== undefined) {
      updates.marked_unread = !!marked_unread;
      if (!marked_unread) {
        updates.last_read_at = new Date().toISOString();
      }
    }

    if (pinned_at !== undefined) {
      if (pinned_at !== null) {
        // Enforce max 3 pinned conversations per company
        const { count: pinnedCount } = await supabaseAdmin
          .from('chat_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .not('pinned_at', 'is', null)
          .neq('id', sessionId);

        if ((pinnedCount || 0) >= 3) {
          res.status(400).json({ error: 'Maximum 3 pinned conversations allowed. Unpin one first.' });
          return;
        }
        updates.pinned_at = new Date().toISOString();
      } else {
        updates.pinned_at = null;
      }
    }

    if (draft_message !== undefined) {
      const trimmed = typeof draft_message === 'string' ? draft_message.trim() : null;
      updates.draft_message = trimmed || null;
    }

    // Only set updated_at when something meaningful changed (not just draft)
    const hasMeaningfulUpdate = Object.keys(updates).some((k) => k !== 'draft_message');
    if (hasMeaningfulUpdate) {
      updates.updated_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .select(
        '*, contact:contact_id(profile_picture_url), conversation_labels(label_id, labels(id, name, color)), assigned_user:assigned_to(id, full_name, avatar_url)'
      )
      .single();

    if (error) {
      // Unique constraint violation: tried to reopen but a newer active session exists
      if (error.code === '23505') {
        res.status(409).json({
          error: 'Cannot reopen this session because a newer active session already exists for this contact.',
        });
        return;
      }
      throw error;
    }

    const result = {
      ...data,
      profile_picture_url: (data.contact as Record<string, unknown>)?.profile_picture_url || null,
      labels:
        data.conversation_labels
          ?.map((cl: Record<string, Record<string, unknown>>) => cl.labels)
          .filter(Boolean) || [],
      assigned_user: data.assigned_user || null,
    };

    res.json({ session: result });

    // Trigger notifications (async, after response sent)
    const contactName = result.contact_name || result.phone_number || 'Unknown';

    // Assignment notification — notify assignee (unless self-assignment)
    if (assigned_to && assigned_to !== req.userId) {
      createNotification({
        companyId,
        userId: assigned_to,
        type: 'assignment',
        title: 'New assignment',
        body: `You were assigned a conversation with ${contactName}`,
        data: { conversation_id: sessionId, contact_name: contactName },
      }).catch((err) => {
        console.error('Assignment notification error:', err);
      });
    }

    // Snooze notification — notify the user who set the snooze
    if (snoozed_until) {
      createNotification({
        companyId,
        userId: req.userId!,
        type: 'snooze_set',
        title: 'Conversation snoozed',
        body: `Snoozed until ${new Date(snoozed_until).toLocaleString()}`,
        data: { conversation_id: sessionId },
      }).catch((err) => console.error('Snooze notification error:', err));
    }

    // Status change notification — notify assignee (unless changed by assignee)
    if (status && result.assigned_to && result.assigned_to !== req.userId) {
      createNotification({
        companyId,
        userId: result.assigned_to,
        type: 'status_change',
        title: 'Status changed',
        body: `Conversation status changed to ${status}`,
        data: { conversation_id: sessionId, new_status: status },
      }).catch((err) => {
        console.error('Status change notification error:', err);
      });
    }

    // Extract memories from the ended session (async, after response sent)
    if (sessionClosed) {
      extractSessionMemories(sessionId as string, companyId).catch((err) => {
        console.error('Memory extraction error:', err);
      });
    }
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

    // Verify all sessions belong to company and user has access
    const { filter: accessFilter } = await getAccessibleSessions(req.userId!, companyId);
    let validQuery = supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .in('id', sessionIds)
      .eq('company_id', companyId);

    if (accessFilter.mode === 'filtered') {
      if (accessFilter.channelIds.length === 0) {
        res.status(404).json({ error: 'No valid sessions found' });
        return;
      }
      validQuery = validQuery.in('channel_id', accessFilter.channelIds);
      if (accessFilter.excludedSessionIds.length > 0) {
        validQuery = validQuery.not('id', 'in', `(${accessFilter.excludedSessionIds.join(',')})`);
      }
    }

    const { data: validSessions } = await validQuery;
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
        // Look up the status in conversation_statuses for this company
        const { data: statusRow } = await supabaseAdmin
          .from('conversation_statuses')
          .select('id, name, "group"')
          .eq('company_id', companyId)
          .eq('name', value)
          .eq('is_deleted', false)
          .single();

        if (!statusRow) {
          res.status(400).json({ error: `Invalid status: "${value}"` });
          return;
        }
        const statusUpdate: Record<string, unknown> = {
          status: value,
          updated_at: new Date().toISOString(),
        };
        // Session boundary based on status group
        if (statusRow.group === 'closed') {
          statusUpdate.ended_at = new Date().toISOString();
        } else {
          statusUpdate.ended_at = null;
        }
        await supabaseAdmin
          .from('chat_sessions')
          .update(statusUpdate)
          .in('id', validIds);
        break;
      }
      case 'priority': {
        const normalizedPriority = String(value).trim();
        const { data: priorityRow } = await supabaseAdmin
          .from('conversation_priorities')
          .select('id')
          .eq('company_id', companyId)
          .eq('name', normalizedPriority)
          .eq('is_deleted', false)
          .single();
        if (!priorityRow) {
          res.status(400).json({ error: 'Invalid priority' });
          return;
        }
        await supabaseAdmin
          .from('chat_sessions')
          .update({ priority: normalizedPriority, updated_at: new Date().toISOString() })
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
      case 'mark_read':
        await supabaseAdmin
          .from('chat_messages')
          .update({ read: true })
          .in('session_id', validIds)
          .eq('direction', 'inbound')
          .eq('read', false);
        await supabaseAdmin
          .from('chat_sessions')
          .update({
            marked_unread: false,
            last_read_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in('id', validIds);
        break;
      case 'mark_unread':
        await supabaseAdmin
          .from('chat_sessions')
          .update({ marked_unread: true, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;
      case 'pin': {
        if (value === true) {
          // Enforce max 3 pinned per company
          const { count: currentPinned } = await supabaseAdmin
            .from('chat_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId)
            .not('pinned_at', 'is', null);

          const { count: alreadyPinned } = await supabaseAdmin
            .from('chat_sessions')
            .select('id', { count: 'exact', head: true })
            .in('id', validIds)
            .not('pinned_at', 'is', null);

          const newPins = validIds.length - (alreadyPinned || 0);
          if ((currentPinned || 0) + newPins > 3) {
            res.status(400).json({
              error: `Cannot pin ${newPins} more conversations. Maximum is 3 pinned total (currently ${currentPinned}).`,
            });
            return;
          }

          await supabaseAdmin
            .from('chat_sessions')
            .update({ pinned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .in('id', validIds)
            .is('pinned_at', null);
        } else {
          await supabaseAdmin
            .from('chat_sessions')
            .update({ pinned_at: null, updated_at: new Date().toISOString() })
            .in('id', validIds);
        }
        break;
      }
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
