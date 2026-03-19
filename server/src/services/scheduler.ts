import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from './whapi.js';
import { getProvider } from './providers/index.js';
import { createNotification } from './notificationService.js';
import { checkRateLimit, incrementRateCounter, check24HourWindow, checkContentSafety, checkDuplicateContent, hashMessageBody, logComplianceMetric, getResponseRateStatus } from './complianceUtils.js';
import { simulateBeforeSend } from './sendSimulator.js';

const POLL_INTERVAL_MS = 30_000;

let isProcessing = false;

async function processScheduledMessages() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Recover messages stuck in 'sending' for more than 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('chat_messages')
      .update({ status: 'scheduled' })
      .eq('status', 'sending')
      .lt('updated_at', fiveMinAgo);

    // Atomically claim a batch of due messages
    const { data: messages, error } = await supabaseAdmin.rpc('claim_scheduled_messages', { batch_size: 5 });

    if (error || !messages || messages.length === 0) return;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      try {
        // Get session and channel info
        const { data: session } = await supabaseAdmin
          .from('chat_sessions')
          .select('channel_id, chat_id, phone_number')
          .eq('id', msg.session_id)
          .single();

        if (!session?.channel_id) {
          await supabaseAdmin
            .from('chat_messages')
            .update({ status: 'failed' })
            .eq('id', msg.id);
          continue;
        }

        const { data: channel } = await supabaseAdmin
          .from('channels')
          .select('channel_token, channel_type')
          .eq('id', session.channel_id)
          .eq('channel_status', 'connected')
          .single();

        if (!channel) {
          await supabaseAdmin
            .from('chat_messages')
            .update({ status: 'failed' })
            .eq('id', msg.id);
          continue;
        }

        // --- Compliance checks ---
        const ct = (channel.channel_type || 'whatsapp') as 'whatsapp' | 'email';

        // Rate limit check — if exceeded, reset to scheduled and skip
        // Also check response rate for throttling
        const responseRate = await getResponseRateStatus(session.channel_id, msg.company_id, ct);
        const effectiveLimit = responseRate.throttled ? 30 : undefined; // 50% of default when throttled
        const rateResult = checkRateLimit(session.channel_id, msg.company_id, effectiveLimit, ct);
        if (!rateResult.allowed) {
          console.warn(`Rate limit exceeded for channel ${session.channel_id}, deferring message ${msg.id}`);
          await supabaseAdmin
            .from('chat_messages')
            .update({ status: 'scheduled' })
            .eq('id', msg.id);
          continue;
        }

        // 24-hour window check — if expired, mark as failed and skip
        const windowResult = await check24HourWindow(msg.session_id, ct);
        if (!windowResult.allowed) {
          console.warn(`24-hour window expired for session ${msg.session_id}, failing message ${msg.id}`);
          await supabaseAdmin
            .from('chat_messages')
            .update({ status: 'failed' })
            .eq('id', msg.id);
          continue;
        }

        // Content safety check — log warnings only, don't block
        const safetyResult = await checkContentSafety(msg.message_body, msg.session_id, ct);
        if (safetyResult.warnings.length > 0) {
          console.warn(`Content safety warnings for message ${msg.id}:`, safetyResult.warnings);
        }

        // Duplicate content check — log warnings only, don't block
        const dupeResult = await checkDuplicateContent(session.channel_id, msg.message_body);
        if (dupeResult.isDuplicate) {
          console.warn(`Duplicate content detected for message ${msg.id}, matchCount: ${dupeResult.matchCount}`);
        }

        // Simulate human-like behavior before sending
        const chatId = session.chat_id.includes('@')
          ? session.chat_id
          : `${session.chat_id}@s.whatsapp.net`;

        await simulateBeforeSend({
          channelToken: channel.channel_token,
          chatId,
          messageType: 'text',
          messageLength: msg.message_body.length,
          path: 'scheduled',
          channelType: ct,
        });

        // Send the message
        const provider = getProvider(channel.channel_type || 'whatsapp');
        const result = await provider.sendMessage(channel as any, session.chat_id, msg.message_body);

        // Update message status
        const now = new Date().toISOString();
        await supabaseAdmin
          .from('chat_messages')
          .update({
            status: 'sent',
            message_ts: now,
            message_id_normalized: result.messageId || null,
            scheduled_for: null,
          })
          .eq('id', msg.id);

        // Only update last_message if this is still the newest message
        await supabaseAdmin
          .from('chat_sessions')
          .update({
            last_message: msg.message_body,
            last_message_at: now,
            last_message_direction: 'outbound',
            last_message_sender: 'human',
            updated_at: now,
          })
          .eq('id', msg.session_id)
          .or(`last_message_at.is.null,last_message_at.lte.${now}`);

        // --- Post-send compliance tracking ---
        incrementRateCounter(session.channel_id, msg.company_id);
        logComplianceMetric(session.channel_id, msg.company_id, {
          type: 'message_sent',
          path: 'scheduled',
          hash: hashMessageBody(msg.message_body),
        });

        // Notify the user that their scheduled message was sent
        if (msg.user_id) {
          createNotification({
            companyId: msg.company_id,
            userId: msg.user_id,
            type: 'schedule_sent',
            title: 'Scheduled message sent',
            body: msg.message_body.slice(0, 120),
            data: { conversation_id: msg.session_id },
          }).catch((err) => console.error('Schedule sent notification error:', err));
        }

        // Inter-message delay to avoid burst patterns
        if (i < messages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, (8 + Math.random() * 12) * 1000));
        }
      } catch (err) {
        console.error(`Failed to send scheduled message ${msg.id}:`, err);
        await supabaseAdmin
          .from('chat_messages')
          .update({ status: 'failed' })
          .eq('id', msg.id);
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err);
  } finally {
    isProcessing = false;
  }
}

export async function startScheduler() {
  // Startup recovery: reset any messages stuck in 'sending' from a previous crash
  await supabaseAdmin
    .from('chat_messages')
    .update({ status: 'scheduled' })
    .eq('status', 'sending');

  console.log('Message scheduler started (polling every 30s)');
  processScheduledMessages().catch((err) => console.error('Initial scheduler run failed:', err));
  setInterval(processScheduledMessages, POLL_INTERVAL_MS);

  // Daily cleanup of old compliance metrics (runs hourly, acts once per 24h)
  let lastCleanup = 0;
  setInterval(async () => {
    const now = Date.now();
    if (now - lastCleanup < 24 * 60 * 60 * 1000) return;
    lastCleanup = now;
    await supabaseAdmin
      .from('compliance_metrics')
      .delete()
      .lt('created_at', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
  }, 60 * 60 * 1000);
}
