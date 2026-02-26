import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from '../services/whapi.js';

const router = Router();
router.use(requireAuth);

// Send a message
router.post('/send', async (req, res, next) => {
  try {
    const userId = req.userId!;
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
      .eq('user_id', userId)
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
        user_id: userId,
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

export default router;
