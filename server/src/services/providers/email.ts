import type { ChannelProvider, ChannelRecord, SendMessageResult } from '../channelProvider.js';
import * as gmail from '../gmail.js';
import juice from 'juice';

export const emailProvider: ChannelProvider = {
  type: 'email',

  async sendMessage(channel, chatId, body, options) {
    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token!,
      refresh_token: channel.oauth_refresh_token!,
    }, channel.id);

    const htmlBody = juice(body);

    if (options?.threadId && options?.inReplyTo) {
      const result = await gmail.sendReply(gmailClient, {
        to: chatId,
        from: channel.email_address!,
        subject: options.subject || '',
        htmlBody,
        threadId: options.threadId,
        inReplyTo: options.inReplyTo,
        references: options.references || '',
        cc: options.cc,
        bcc: options.bcc,
        signature: channel.email_signature || undefined,
      });
      return { messageId: result.messageId, threadId: result.threadId };
    } else {
      const result = await gmail.sendNew(gmailClient, {
        to: chatId,
        from: channel.email_address!,
        subject: options?.subject || '',
        htmlBody,
        cc: options?.cc,
        bcc: options?.bcc,
        signature: channel.email_signature || undefined,
      });
      return { messageId: result.messageId, threadId: result.threadId };
    }
  },

  async normalizeWebhookPayload() {
    return [];
  },

  async downloadMedia(channel, attachmentId) {
    const [messageId, attId] = attachmentId.split(':');
    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token!,
      refresh_token: channel.oauth_refresh_token!,
    }, channel.id);
    return gmail.getAttachment(gmailClient, messageId, attId);
  },

  async getContactProfile() {
    return null;
  },
};
