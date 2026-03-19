import * as whapi from '../whapi.js';
import type { ChannelProvider, ChannelRecord, IncomingMessage, SendMessageResult } from '../channelProvider.js';
import type { WhapiIncomingMessage, WhapiWebhookPayload, WhapiStatusUpdate } from '../../types/webhook.js';

function normalizeChatId(chatId?: string | null): string | null {
  if (!chatId) return null;
  return chatId.replace(/@.*$/, '');
}

function formatJid(chatId: string): string {
  return chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
}

function extractMessageBody(msg: WhapiIncomingMessage): string {
  if (msg.type === 'text' && msg.text?.body) return msg.text.body;
  if (msg.type === 'link_preview' && msg.link_preview?.body) return msg.link_preview.body;
  if (msg.type === 'image' && msg.image?.caption) return msg.image.caption;
  if (msg.type === 'video' && msg.video?.caption) return msg.video.caption;
  if (msg.type === 'document' && msg.document?.caption) return msg.document.caption;
  if (msg.type === 'audio') return '[Audio message]';
  if (msg.type === 'voice' || msg.type === 'ptt') return '[Voice message]';
  if (msg.type === 'sticker') return '[Sticker]';
  if (msg.type === 'interactive') return msg.interactive?.body?.text || '[Interactive message]';
  if (msg.type === 'reply') {
    return msg.reply?.buttons_reply?.title || msg.reply?.list_reply?.title || '[Reply]';
  }
  if (msg.type === 'action' && msg.action?.type === 'reaction') return '';
  return msg.text?.body || '';
}

export const whatsappProvider: ChannelProvider = {
  type: 'whatsapp',

  async sendMessage(channel, chatId, body, options) {
    const jid = formatJid(chatId);
    const result = await whapi.sendTextMessage(
      channel.channel_token!,
      jid,
      body,
      options?.quotedMessageId || undefined
    );
    const messageId = (result as any)?.message?.id || (result as any)?.message_id || null;
    return { messageId };
  },

  async normalizeWebhookPayload(payload: WhapiWebhookPayload, channel) {
    const messages: IncomingMessage[] = [];
    if (!payload.messages) return messages;

    for (const msg of payload.messages) {
      if (msg.chat_id?.endsWith('@g.us')) continue;

      const isOutbound = msg.from_me === true;
      const normalizedChatId = normalizeChatId(msg.chat_id) || normalizeChatId(msg.from);
      const counterpartyPhone = isOutbound
        ? normalizeChatId(msg.to) || normalizeChatId(msg.chat_id)
        : normalizeChatId(msg.from);

      const mediaPayload = msg.image || msg.document || msg.audio || msg.voice || msg.video || msg.sticker;

      messages.push({
        id: msg.id,
        chatId: normalizedChatId || '',
        senderIdentifier: counterpartyPhone || '',
        senderName: msg.from_name || null,
        body: extractMessageBody(msg),
        messageType: msg.type || 'text',
        direction: isOutbound ? 'outbound' : 'inbound',
        timestamp: new Date((msg.timestamp || 0) * 1000),
        isFromMe: isOutbound,
        metadata: {
          raw: msg,
          link_preview: msg.link_preview,
          context: msg.context,
          action: msg.action,
        },
        media: mediaPayload ? {
          url: (mediaPayload as any).link,
          id: (mediaPayload as any).id,
          mimeType: (mediaPayload as any).mime_type,
          filename: (mediaPayload as any).filename,
          caption: (mediaPayload as any).caption,
        } : undefined,
        replyTo: msg.context?.quoted_id ? {
          messageId: msg.context.quoted_id,
          body: msg.context?.quoted_content?.body,
        } : undefined,
      });
    }
    return messages;
  },

  async normalizeStatusUpdate(payload: WhapiWebhookPayload) {
    if (!payload.statuses) return [];
    return payload.statuses.map((s: WhapiStatusUpdate) => ({
      messageId: s.id,
      status: s.status,
    }));
  },

  async downloadMedia(channel, mediaId) {
    return whapi.downloadMediaById(channel.channel_token!, mediaId);
  },

  async getContactProfile(channel, identifier) {
    try {
      const profile = await whapi.getContactProfile(channel.channel_token!, identifier);
      return {
        name: profile.name || undefined,
        avatarUrl: profile.icon_full || profile.icon || undefined,
      };
    } catch {
      return null;
    }
  },

  async starMessage(channel, messageId, star) {
    if (star) await whapi.starMessage(channel.channel_token!, messageId);
    else await whapi.unstarMessage(channel.channel_token!, messageId);
  },

  async pinMessage(channel, messageId, pin) {
    if (pin) await whapi.pinMessage(channel.channel_token!, messageId);
    else await whapi.unpinMessage(channel.channel_token!, messageId);
  },

  async reactToMessage(channel, messageId, emoji) {
    await whapi.reactToMessage(channel.channel_token!, messageId, emoji);
  },

  async forwardMessage(channel, messageId, targetChatId) {
    return whapi.forwardMessage(channel.channel_token!, messageId, formatJid(targetChatId));
  },
};
