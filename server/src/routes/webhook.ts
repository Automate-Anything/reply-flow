import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { processIncomingMessage } from '../services/messageProcessor.js';
import type { WhapiWebhookPayload } from '../types/webhook.js';

const router = Router();

// No auth — Whapi calls this endpoint directly
router.post('/', async (req, res) => {
  try {
    const payload = req.body as WhapiWebhookPayload;

    // Acknowledge immediately so Whapi doesn't retry
    res.status(200).json({ status: 'ok' });

    if (!payload.messages || payload.messages.length === 0) return;

    for (const msg of payload.messages) {
      // Skip outgoing messages (from us)
      if (msg.from === msg.to) continue;

      // Find which user owns this channel by matching the "to" number
      const toPhone = msg.to?.replace(/@.*$/, '');
      const { data: channel } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id, user_id')
        .eq('phone_number', toPhone)
        .eq('channel_status', 'connected')
        .single();

      if (!channel) {
        console.warn(`No connected channel found for incoming message to ${toPhone}`);
        continue;
      }

      await processIncomingMessage(msg, channel.user_id, channel.id);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already sent 200, just log the error
  }
});

export default router;
