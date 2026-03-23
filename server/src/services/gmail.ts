import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

// Create a fresh OAuth2 client for a given channel's tokens
// channelId is required when tokens are provided so refreshed tokens can be persisted
export function createOAuth2Client(tokens?: {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}, channelId?: number): OAuth2Client {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
  if (tokens) {
    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });
    // Listen for token refresh events — MUST persist new tokens to DB
    client.on('tokens', async (newTokens) => {
      console.log('[gmail] Token refreshed, persisting to DB');
      try {
        const updateData: Record<string, unknown> = {
          oauth_access_token: newTokens.access_token,
          oauth_token_expiry: newTokens.expiry_date
            ? new Date(newTokens.expiry_date).toISOString()
            : null,
        };
        if (newTokens.refresh_token) {
          updateData.oauth_refresh_token = newTokens.refresh_token;
        }
        await supabaseAdmin
          .from('channels')
          .update(updateData)
          .eq('id', channelId);
      } catch (err) {
        console.error('[gmail] Failed to persist refreshed tokens:', err);
      }
    });
  }
  return client;
}

// Generate the OAuth consent URL
export function getAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

// Exchange authorization code for tokens
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string;
}> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
    email: data.email!,
  };
}

// Create Gmail API client for a channel
export function getGmailClient(tokens: {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}, channelId?: number): gmail_v1.Gmail {
  const client = createOAuth2Client(tokens, channelId);
  return google.gmail({ version: 'v1', auth: client });
}

// Register a watch on the user's inbox
export async function registerWatch(gmail: gmail_v1.Gmail): Promise<{
  historyId: string;
  expiration: string;
}> {
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: env.GOOGLE_PUBSUB_TOPIC,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });
  return {
    historyId: res.data.historyId!,
    expiration: res.data.expiration!,
  };
}

// Fetch new messages since a historyId
export async function getHistoryChanges(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
      pageToken,
    });

    if (res.data.history) {
      for (const h of res.data.history) {
        if (h.messagesAdded) {
          for (const added of h.messagesAdded) {
            if (added.message?.id) {
              messageIds.push(added.message.id);
            }
          }
        }
      }
    }
    latestHistoryId = res.data.historyId || latestHistoryId;
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return { messageIds, newHistoryId: latestHistoryId };
}

// Get a single message with full detail
export async function getMessage(gmail: gmail_v1.Gmail, messageId: string) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

// Parse email headers
export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}

// Extract body from MIME parts (recursive)
export function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string = 'text/html'
): string | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part, mimeType);
      if (result) return result;
    }
  }
  return null;
}

// Extract attachments metadata from MIME parts
export function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> {
  const attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size || 0,
      });
    }
    attachments.push(...extractAttachments(part));
  }
  return attachments;
}

// List messages from inbox within a time range (for historical sync)
export async function listMessages(
  gmail: gmail_v1.Gmail,
  options: { after: Date; maxResults?: number }
): Promise<string[]> {
  const afterEpoch = Math.floor(options.after.getTime() / 1000);
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  const max = options.maxResults || 500;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterEpoch} in:inbox`,
      maxResults: Math.min(100, max - messageIds.length),
      pageToken,
    });

    if (res.data.messages) {
      for (const msg of res.data.messages) {
        if (msg.id) messageIds.push(msg.id);
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken && messageIds.length < max);

  return messageIds;
}

// Send an email reply (with proper threading headers)
export async function sendReply(
  gmail: gmail_v1.Gmail,
  options: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
    threadId: string;
    inReplyTo: string;
    references: string;
    cc?: string[];
    bcc?: string[];
    signature?: string;
  }
): Promise<{ messageId: string; threadId: string }> {
  const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default;

  const fullHtml = options.signature
    ? `${options.htmlBody}<br/><br/>--<br/>${options.signature}`
    : options.htmlBody;

  const mail = new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject.startsWith('Re:') ? options.subject : `Re: ${options.subject}`,
    inReplyTo: options.inReplyTo,
    references: options.references,
    html: fullHtml,
    text: options.textBody,
  });

  const msg = await mail.compile().build();
  const raw = msg.toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: options.threadId },
  });

  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
  };
}

// Send a new email (not a reply)
export async function sendNew(
  gmail: gmail_v1.Gmail,
  options: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
    cc?: string[];
    bcc?: string[];
    signature?: string;
  }
): Promise<{ messageId: string; threadId: string }> {
  const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default;

  const fullHtml = options.signature
    ? `${options.htmlBody}<br/><br/>--<br/>${options.signature}`
    : options.htmlBody;

  const mail = new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject,
    html: fullHtml,
    text: options.textBody,
  });

  const msg = await mail.compile().build();
  const raw = msg.toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
  };
}

// Download an attachment
export async function getAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return Buffer.from(res.data.data!, 'base64url');
}
