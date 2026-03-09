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

    for (const msg of payload.messages) {
      console.log(`[webhook] processing msg id=${msg.id} from=${msg.from} to=${msg.to} type=${msg.type}`);

      // Skip outgoing messages (from us)
      if (msg.from === msg.to) {
        console.log(`[webhook] skipping outgoing message (from === to)`);
        continue;
      }

      // Find which user owns this channel by matching the "to" number
      const toPhone = msg.to?.replace(/@.*$/, '');
      console.log(`[webhook] looking up channel for phone=${toPhone}`);

      const { data: channel, error: channelError } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id, company_id, channel_status, phone_number')
        .eq('phone_number', toPhone)
        .single();

      if (channelError || !channel) {
        console.warn(`[webhook] no channel found at all for phone=${toPhone}`, channelError);
        continue;
      }

      console.log(`[webhook] found channel id=${channel.id} status=${channel.channel_status} stored_phone=${channel.phone_number}`);

      if (channel.channel_status !== 'connected') {
        console.warn(`[webhook] channel ${channel.id} is not connected (status=${channel.channel_status}), skipping`);
        continue;
      }

      await processIncomingMessage(msg, channel.company_id, channel.id);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already sent 200, just log the error
  }
});

export default router;
