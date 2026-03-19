import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as gmail from '../services/gmail.js';
import type { ChannelRecord } from '../services/channelProvider.js';

const router = Router();

router.post('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    const token = (req.query.token as string) || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (token !== env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
      return res.status(403).send('Forbidden');
    }
  }

  res.status(200).send('OK');

  try {
    const { message } = req.body;
    if (!message?.data) return;

    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const { emailAddress, historyId } = data;
    if (!emailAddress || !historyId) return;

    const { data: channels } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('email_address', emailAddress)
      .eq('channel_type', 'email')
      .eq('channel_status', 'connected');

    if (!channels || channels.length === 0) {
      console.warn(`[gmail-webhook] No connected channel for ${emailAddress}`);
      return;
    }

    for (const channel of channels) {
      if (channel.gmail_history_id && BigInt(historyId) <= BigInt(channel.gmail_history_id)) {
        continue;
      }

      const gmailClient = gmail.getGmailClient({
        access_token: channel.oauth_access_token!,
        refresh_token: channel.oauth_refresh_token!,
      }, channel.id);

      let changes;
      try {
        changes = await gmail.getHistoryChanges(gmailClient, channel.gmail_history_id || historyId);
      } catch (err: any) {
        if (err.code === 404) {
          console.warn(`[gmail-webhook] historyId too old for ${emailAddress}, resetting`);
          const profile = await gmailClient.users.getProfile({ userId: 'me' });
          await supabaseAdmin
            .from('channels')
            .update({ gmail_history_id: profile.data.historyId })
            .eq('id', channel.id);
          continue;
        }
        throw err;
      }

      for (const messageId of changes.messageIds) {
        try {
          const msg = await gmail.getMessage(gmailClient, messageId);
          if (!msg.payload) continue;

          const headers = msg.payload.headers || [];
          const from = gmail.getHeader(headers, 'From') || '';
          const to = gmail.getHeader(headers, 'To') || '';
          const subject = gmail.getHeader(headers, 'Subject') || '(no subject)';
          const messageIdHeader = gmail.getHeader(headers, 'Message-ID') || '';

          const isOutbound = from.toLowerCase().includes(channel.email_address!.toLowerCase());

          const senderEmail = isOutbound ? extractEmail(to) : extractEmail(from);
          const senderName = isOutbound ? extractName(to) : extractName(from);

          const htmlBody = gmail.extractBody(msg.payload, 'text/html');
          const textBody = gmail.extractBody(msg.payload, 'text/plain');
          const attachments = gmail.extractAttachments(msg.payload);

          await processGmailMessage({
            channel: channel as ChannelRecord,
            gmailMessageId: msg.id!,
            threadId: msg.threadId!,
            from, to,
            cc: gmail.getHeader(headers, 'Cc') || '',
            bcc: gmail.getHeader(headers, 'Bcc') || '',
            subject,
            messageIdHeader,
            inReplyTo: gmail.getHeader(headers, 'In-Reply-To') || '',
            references: gmail.getHeader(headers, 'References') || '',
            htmlBody: htmlBody || textBody || '',
            textBody: textBody || '',
            senderEmail, senderName, isOutbound,
            timestamp: new Date(parseInt(msg.internalDate || '0')),
            labelIds: msg.labelIds || [],
            attachments,
          });
        } catch (msgErr) {
          console.error(`[gmail-webhook] Error processing message ${messageId}:`, msgErr);
        }
      }

      await supabaseAdmin
        .from('channels')
        .update({ gmail_history_id: changes.newHistoryId })
        .eq('id', channel.id);
    }
  } catch (err) {
    console.error('[gmail-webhook] Error:', err);
  }
});

function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str.trim();
}

function extractName(str: string): string {
  const match = str.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : '';
}

async function processGmailMessage(params: {
  channel: ChannelRecord;
  gmailMessageId: string;
  threadId: string;
  from: string; to: string; cc: string; bcc: string;
  subject: string; messageIdHeader: string;
  inReplyTo: string; references: string;
  htmlBody: string; textBody: string;
  senderEmail: string; senderName: string;
  isOutbound: boolean; timestamp: Date;
  labelIds: string[];
  attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>;
}) {
  const {
    channel, gmailMessageId, threadId, subject, senderEmail, senderName,
    isOutbound, timestamp, htmlBody, textBody, from, to, cc, bcc,
    messageIdHeader, inReplyTo, references, attachments,
  } = params;

  const { data: existing } = await supabaseAdmin
    .from('chat_messages')
    .select('id')
    .eq('message_id_normalized', gmailMessageId)
    .single();

  if (existing) return;

  let contact;
  if (!isOutbound && senderEmail) {
    const { data: existingContact } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, email')
      .eq('company_id', channel.company_id)
      .eq('email', senderEmail)
      .eq('is_deleted', false)
      .single();

    if (existingContact) {
      contact = existingContact;
    } else {
      const { data: newContact } = await supabaseAdmin
        .from('contacts')
        .insert({
          company_id: channel.company_id,
          created_by: channel.created_by as string,
          email: senderEmail,
          first_name: senderName || senderEmail.split('@')[0],
          phone_number: '',
        })
        .select('id, first_name, last_name, email')
        .single();
      contact = newContact;
    }
  }

  const chatId = threadId;
  let session;
  const { data: existingSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, contact_id')
    .eq('channel_id', channel.id)
    .eq('chat_id', chatId)
    .single();

  if (existingSession) {
    session = existingSession;
  } else {
    const { data: newSession } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        company_id: channel.company_id,
        user_id: channel.created_by as string,
        channel_id: channel.id,
        chat_id: chatId,
        phone_number: senderEmail,
        contact_name: senderName || senderEmail,
        contact_id: contact?.id || null,
        status: 'open',
      })
      .select('id, contact_id')
      .single();
    session = newSession;
  }

  if (!session) return;

  await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: session.id,
      company_id: channel.company_id,
      chat_id_normalized: chatId,
      phone_number: senderEmail,
      message_body: textBody || htmlBody?.replace(/<[^>]*>/g, '') || '',
      message_type: 'email',
      message_id_normalized: gmailMessageId,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender_type: isOutbound ? 'human' : 'contact',
      status: 'delivered',
      metadata: {
        subject, from, to, cc, bcc,
        message_id_header: messageIdHeader,
        in_reply_to: inReplyTo,
        references,
        html_body: htmlBody,
        attachments: attachments.map(a => ({
          filename: a.filename, mimeType: a.mimeType,
          size: a.size, attachmentId: a.attachmentId,
        })),
      },
      message_ts: timestamp.toISOString(),
    })
    .select('id')
    .single();

  await supabaseAdmin
    .from('chat_sessions')
    .update({
      last_message: `${subject}: ${(textBody || '').substring(0, 100)}`,
      last_message_at: timestamp.toISOString(),
      last_message_direction: isOutbound ? 'outbound' : 'inbound',
      last_message_sender: isOutbound ? 'human' : 'contact',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);
}

export default router;
