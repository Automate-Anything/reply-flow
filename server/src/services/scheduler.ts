import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from './whapi.js';

const POLL_INTERVAL_MS = 30_000;

async function processScheduledMessages() {
  try {
    // Find messages that are due
    const { data: messages, error } = await supabaseAdmin
      .from('chat_messages')
      .select('id, session_id, company_id, message_body, chat_id_normalized')
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50);

    if (error || !messages || messages.length === 0) return;

    for (const msg of messages) {
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
          .from('whatsapp_channels')
          .select('channel_token')
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

        // Send the message
        const chatId = session.chat_id.includes('@')
          ? session.chat_id
          : `${session.chat_id}@s.whatsapp.net`;

        const result = await whapi.sendTextMessage(channel.channel_token, chatId, msg.message_body);
        const resultRecord = result as Record<string, unknown> & {
          message?: { id?: string };
          message_id?: string;
        };

        // Update message status
        const now = new Date().toISOString();
        await supabaseAdmin
          .from('chat_messages')
          .update({
            status: 'sent',
            message_ts: now,
            message_id_normalized: resultRecord.message?.id || resultRecord.message_id || null,
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
  }
}

export function startScheduler() {
  console.log('Message scheduler started (polling every 30s)');
  processScheduledMessages().catch((err) => console.error('Initial scheduler run failed:', err));
  setInterval(processScheduledMessages, POLL_INTERVAL_MS);
}
