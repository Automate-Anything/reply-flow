// The canonical message shape that all providers normalize to
export interface IncomingMessage {
  id: string;
  chatId: string;
  senderIdentifier: string;
  senderName: string | null;
  body: string;
  htmlBody?: string;
  subject?: string;
  messageType: string;
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  isFromMe: boolean;
  metadata: Record<string, unknown>;
  media?: {
    url?: string;
    id?: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
  replyTo?: {
    messageId: string;
    body?: string;
  };
  threadId?: string;
}

export interface SendMessageResult {
  messageId: string;
  threadId?: string;
}

export interface ChannelProvider {
  readonly type: 'whatsapp' | 'email';

  sendMessage(channel: ChannelRecord, chatId: string, body: string, options?: {
    htmlBody?: string;
    subject?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    cc?: string[];
    bcc?: string[];
    quotedMessageId?: string;
  }): Promise<SendMessageResult>;

  normalizeWebhookPayload(payload: unknown, channel: ChannelRecord): Promise<IncomingMessage[]>;

  normalizeStatusUpdate?(payload: unknown): Promise<Array<{ messageId: string; status: string }>>;

  downloadMedia?(channel: ChannelRecord, mediaId: string): Promise<Buffer | null>;

  getContactProfile?(channel: ChannelRecord, identifier: string): Promise<{
    name?: string;
    avatarUrl?: string;
  } | null>;

  starMessage?(channel: ChannelRecord, messageId: string, star: boolean): Promise<void>;
  pinMessage?(channel: ChannelRecord, messageId: string, pin: boolean): Promise<void>;
  reactToMessage?(channel: ChannelRecord, messageId: string, emoji: string): Promise<void>;
  forwardMessage?(channel: ChannelRecord, messageId: string, targetChatId: string): Promise<unknown>;
}

export interface ChannelRecord {
  id: number;
  company_id: string;
  channel_type: 'whatsapp' | 'email';
  channel_id: string | null;
  channel_token: string | null;
  channel_name: string | null;
  channel_status: string;
  phone_number: string | null;
  email_address: string | null;
  display_identifier: string | null;
  profile_name: string | null;
  profile_picture_url: string | null;
  webhook_registered: boolean;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_token_expiry: string | null;
  gmail_history_id: string | null;
  gmail_watch_expiry: string | null;
  email_signature: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  workspace_id: string | null;
  [key: string]: unknown;
}
