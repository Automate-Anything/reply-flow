import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from '../services/whapi.js';

const router = Router();
router.use(requireAuth);

// Send a message
router.post('/send', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, body, quotedMessageId } = req.body;

    if (!sessionId || !body) {
      res.status(400).json({ error: 'sessionId and body are required' });
      return;
    }

    // Get session info (includes channel_id to derive which channel to send through)
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('chat_id, phone_number, channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.channel_id) {
      res.status(400).json({ error: 'Conversation is not linked to a channel' });
      return;
    }

    // Get channel token via the session's channel
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected WhatsApp channel for this conversation' });
      return;
    }

    // Resolve quoted message if replying
    let replyMetadata: Record<string, unknown> | null = null;
    let whapiQuotedId: string | undefined;

    if (quotedMessageId) {
      const { data: quotedMsg } = await supabaseAdmin
        .from('chat_messages')
        .select('message_id_normalized, message_body, sender_type, message_type')
        .eq('id', quotedMessageId)
        .eq('company_id', companyId)
        .single();

      if (quotedMsg) {
        whapiQuotedId = quotedMsg.message_id_normalized || undefined;
        replyMetadata = {
          reply: {
            quoted_message_id: quotedMsg.message_id_normalized,
            quoted_content: (quotedMsg.message_body || '').slice(0, 200),
            quoted_sender: quotedMsg.sender_type,
            quoted_type: quotedMsg.message_type,
          },
        };
      }
    }

    // Send via Whapi
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;

    const result = await whapi.sendTextMessage(channel.channel_token, chatId, body, whapiQuotedId);

    // Store in DB
    const now = new Date().toISOString();
    const { data: message, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: body,
        message_type: 'text',
        message_id_normalized: (result as Record<string, string>)?.message_id || null,
        direction: 'outbound',
        sender_type: 'human',
        status: 'sent',
        read: true,
        message_ts: now,
        metadata: replyMetadata,
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update session
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: body,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
      })
      .eq('id', sessionId);

    res.json({ message });
  } catch (err) {
    next(err);
  }
});

// Schedule a message for later
router.post('/schedule', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, body, scheduledFor } = req.body;

    if (!sessionId || !body || !scheduledFor) {
      res.status(400).json({ error: 'sessionId, body, and scheduledFor are required' });
      return;
    }

    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      res.status(400).json({ error: 'scheduledFor must be a valid future timestamp' });
      return;
    }

    // Verify session exists and belongs to this company
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('chat_id, phone_number, channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.channel_id) {
      res.status(400).json({ error: 'Conversation is not linked to a channel' });
      return;
    }

    // Store scheduled message (don't send yet)
    const { data: message, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: body,
        message_type: 'text',
        direction: 'outbound',
        sender_type: 'human',
        status: 'scheduled',
        scheduled_for: scheduledDate.toISOString(),
        read: true,
      })
      .select()
      .single();

    if (msgError) throw msgError;

    res.json({ message });
  } catch (err) {
    next(err);
  }
});

// Cancel a scheduled message
router.delete('/scheduled/:messageId', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .delete()
      .eq('id', messageId)
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Scheduled message not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Helper: look up message + its channel token ──────────────────────────────
async function getMessageWithChannel(messageId: string, companyId: string) {
  const { data: msg } = await supabaseAdmin
    .from('chat_messages')
    .select('id, session_id, message_id_normalized, message_body, message_type, sender_type, is_starred, is_pinned, reactions')
    .eq('id', messageId)
    .eq('company_id', companyId)
    .single();

  if (!msg) return null;

  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id')
    .eq('id', msg.session_id)
    .single();

  if (!session?.channel_id) return { msg, channelToken: null };

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', session.channel_id)
    .eq('channel_status', 'connected')
    .single();

  return { msg, channelToken: channel?.channel_token || null };
}

// ── Star message ─────────────────────────────────────────────────────────────
router.post('/:messageId/star', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    const newStarred = !result.msg.is_starred;
    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ is_starred: newStarred })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      (newStarred
        ? whapi.starMessage(result.channelToken, result.msg.message_id_normalized)
        : whapi.unstarMessage(result.channelToken, result.msg.message_id_normalized)
      ).catch((err) => console.error('Whapi star error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── Pin message ──────────────────────────────────────────────────────────────
router.post('/:messageId/pin', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    const newPinned = !result.msg.is_pinned;
    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ is_pinned: newPinned })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      (newPinned
        ? whapi.pinMessage(result.channelToken, result.msg.message_id_normalized)
        : whapi.unpinMessage(result.channelToken, result.msg.message_id_normalized)
      ).catch((err) => console.error('Whapi pin error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── React to message ─────────────────────────────────────────────────────────
router.post('/:messageId/react', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { messageId } = req.params;
    const { emoji } = req.body;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    // Update reactions array: remove existing reaction by this user, add new if emoji provided
    const reactions = Array.isArray(result.msg.reactions) ? [...result.msg.reactions] : [];
    const filtered = reactions.filter((r: { user_id: string }) => r.user_id !== userId);
    if (emoji) {
      filtered.push({ emoji, user_id: userId });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ reactions: filtered })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      whapi.reactToMessage(result.channelToken, result.msg.message_id_normalized, emoji || '')
        .catch((err) => console.error('Whapi react error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── Forward message ──────────────────────────────────────────────────────────
router.post('/:messageId/forward', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;
    const { targetSessionId } = req.body;

    if (!targetSessionId) {
      res.status(400).json({ error: 'targetSessionId is required' });
      return;
    }

    // Get original message
    const { data: originalMsg } = await supabaseAdmin
      .from('chat_messages')
      .select('id, session_id, message_id_normalized, message_body, message_type')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .single();

    if (!originalMsg) { res.status(404).json({ error: 'Message not found' }); return; }

    // Get original message's channel token (for Whapi forward)
    const { data: origSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', originalMsg.session_id)
      .single();

    // Get target session info
    const { data: targetSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, chat_id, phone_number, channel_id')
      .eq('id', targetSessionId)
      .eq('company_id', companyId)
      .single();

    if (!targetSession) { res.status(404).json({ error: 'Target session not found' }); return; }

    // Forward via Whapi (fire-and-forget)
    if (origSession?.channel_id && originalMsg.message_id_normalized) {
      const { data: channel } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('channel_token')
        .eq('id', origSession.channel_id)
        .eq('channel_status', 'connected')
        .single();

      if (channel) {
        const targetChatId = targetSession.chat_id.includes('@')
          ? targetSession.chat_id
          : `${targetSession.chat_id}@s.whatsapp.net`;

        whapi.forwardMessage(channel.channel_token, originalMsg.message_id_normalized, targetChatId)
          .catch((err) => console.error('Whapi forward error:', err.message));
      }
    }

    // Store forwarded message in our DB
    const now = new Date().toISOString();
    const { data: newMsg, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: targetSessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: targetSession.chat_id,
        phone_number: targetSession.phone_number,
        message_body: originalMsg.message_body,
        message_type: originalMsg.message_type,
        direction: 'outbound',
        sender_type: 'human',
        status: 'sent',
        read: true,
        message_ts: now,
        metadata: { forwarded_from: { session_id: originalMsg.session_id, message_id: originalMsg.id } },
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update target session
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: originalMsg.message_body,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
      })
      .eq('id', targetSessionId);

    res.json({ message: newMsg });
  } catch (err) {
    next(err);
  }
});

export default router;
