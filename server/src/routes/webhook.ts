import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { processIncomingMessage } from '../services/messageProcessor.js';
import type { WhapiWebhookPayload } from '../types/webhook.js';

const router = Router();

// No auth — Whapi calls this endpoint directly
router.post('/', async (req, res) => {
  try {
    const payload = req.body as WhapiWebhookPayload;

    console.log('[webhook] received payload:', JSON.stringify(payload, null, 2));

    // Acknowledge immediately so Whapi doesn't retry
    res.status(200).json({ status: 'ok' });

    if (!payload.messages || payload.messages.length === 0) {
      console.log('[webhook] no messages in payload, skipping');
      return;
    }

    // Look up the channel once using the top-level channel_id from the payload
    const whapiChannelId = payload.channel_id;
    console.log(`[webhook] looking up channel for whapi channel_id=${whapiChannelId}`);

    if (!whapiChannelId) {
      console.warn('[webhook] no channel_id in payload, cannot route messages');
      return;
    }

    const { data: channel, error: channelError } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, company_id, channel_status')
      .eq('channel_id', whapiChannelId)
      .eq('channel_status', 'connected')
      .single();

    if (channelError || !channel) {
      console.warn(`[webhook] no connected channel found for whapi channel_id=${whapiChannelId}`, channelError);
      return;
    }

    console.log(`[webhook] matched channel id=${channel.id}`);

    for (const msg of payload.messages) {
      console.log(`[webhook] processing msg id=${msg.id} from=${msg.from} type=${msg.type}`);

      // Skip outgoing messages
      if (msg.from_me) continue;

      await processIncomingMessage(msg, channel.company_id, channel.id);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already sent 200, just log the error
  }
});

export default router;
