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

    const whapiChannelId = payload.channel_id;
    if (!whapiChannelId) return;

    const { data: channel, error: channelError } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, user_id, company_id, channel_status, phone_number')
      .eq('channel_id', whapiChannelId)
      .eq('channel_status', 'connected')
      .single();

    if (channelError || !channel) return;

    for (const msg of payload.messages) {
      // Skip group messages (chat_id ends with @g.us)
      if (msg.chat_id?.endsWith('@g.us')) continue;

      await processIncomingMessage(msg, channel.company_id, channel.id, channel.user_id, channel.phone_number ?? undefined);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already sent 200, just log the error
  }
});

export default router;
