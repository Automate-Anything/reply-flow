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
    const { sessionId, body } = req.body;

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

    // Send via Whapi
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;

    const result = await whapi.sendTextMessage(channel.channel_token, chatId, body);

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

export default router;
