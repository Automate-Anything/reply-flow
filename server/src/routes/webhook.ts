import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { processIncomingMessage } from '../services/messageProcessor.js';
import type { WhapiWebhookPayload, WhapiStatusUpdate } from '../types/webhook.js';

const router = Router();

// Status progression — only allow forward transitions (never downgrade)
const STATUS_RANK: Record<string, number> = {
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  played: 5,
  failed: 0,
  deleted: 6,
};

async function processStatusUpdate(status: WhapiStatusUpdate, companyId: string) {
  const newStatus = status.status;
  if (!newStatus || !STATUS_RANK.hasOwnProperty(newStatus)) return;

  console.log(`[webhook] Status update: msgId=${status.id} status=${newStatus}`);

  // Find the message by its Whapi message ID
  const { data: message } = await supabaseAdmin
    .from('chat_messages')
    .select('id, status')
    .eq('message_id_normalized', status.id)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!message) {
    console.log(`[webhook] Status update: no matching message for id=${status.id}`);
    return;
  }

  // Only update if new status is a forward progression (or failed)
  const currentRank = STATUS_RANK[message.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;
  if (newStatus !== 'failed' && newRank <= currentRank) return;

  await supabaseAdmin
    .from('chat_messages')
    .update({ status: newStatus })
    .eq('id', message.id);
}

// No auth — Whapi calls this endpoint directly
router.post('/', async (req, res) => {
  try {
    const payload = req.body as WhapiWebhookPayload;

    // Acknowledge immediately so Whapi doesn't retry
    res.status(200).json({ status: 'ok' });

    // DEBUG: log status webhooks to DB for inspection
    if (payload.statuses?.length) {
      supabaseAdmin.from('debug_webhook_log').insert({ payload: { type: 'status', body: req.body } }).then();
    }

    const whapiChannelId = payload.channel_id;
    if (!whapiChannelId) {
      // Log payloads without channel_id — status webhooks might have a different format
      supabaseAdmin.from('debug_webhook_log').insert({ payload: { type: 'no_channel_id', keys: Object.keys(req.body as Record<string, unknown>), body: req.body } }).then();
      return;
    }

    const { data: channel, error: channelError } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, user_id, company_id, channel_status, phone_number')
      .eq('channel_id', whapiChannelId)
      .eq('channel_status', 'connected')
      .single();

    if (channelError || !channel) return;

    // Process message status updates (sent → delivered → read)
    if (payload.statuses && payload.statuses.length > 0) {
      for (const status of payload.statuses) {
        try {
          await processStatusUpdate(status, channel.company_id);
        } catch (err) {
          console.error('Status update error:', err);
        }
      }
    }

    // Process incoming messages
    if (payload.messages && payload.messages.length > 0) {
      for (const msg of payload.messages) {
        // Skip group messages (chat_id ends with @g.us)
        if (msg.chat_id?.endsWith('@g.us')) continue;

        await processIncomingMessage(msg, channel.company_id, channel.id, channel.user_id, channel.phone_number ?? undefined);
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already sent 200, just log the error
  }
});

export default router;
