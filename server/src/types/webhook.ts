// Whapi webhook payload for incoming messages
export interface WhapiWebhookPayload {
  messages?: WhapiIncomingMessage[];
  statuses?: WhapiStatusUpdate[];
  channel_id?: string;
}

export interface WhapiIncomingMessage {
  id: string;
  from: string;
  to?: string;
  from_me?: boolean;
  timestamp: number;
  type: string;
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    caption?: string;
    link?: string;
  };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    link?: string;
  };
  audio?: {
    id: string;
    mime_type: string;
    link?: string;
    duration?: number;
  };
  voice?: {
    id: string;
    mime_type: string;
    link?: string;
    duration?: number;
  };
  video?: {
    id: string;
    mime_type: string;
    caption?: string;
    link?: string;
  };
  sticker?: {
    id: string;
    mime_type: string;
    link?: string;
    animated?: boolean;
  };
  interactive?: {
    type?: string;
    header?: { type?: string; text?: string };
    body?: { text?: string };
    footer?: { text?: string };
    action?: {
      buttons?: Array<{ type?: string; reply?: { id?: string; title?: string } }>;
      sections?: Array<{ title?: string; rows?: Array<{ id?: string; title?: string; description?: string }> }>;
      name?: string;
      product_retailer_id?: string;
    };
  };
  action?: {
    type?: string;
    target?: string;
    emoji?: string;
    votes?: string[];
  };
  reply?: {
    type?: string;
    buttons_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  link_preview?: {
    body?: string;
    url?: string;
    title?: string;
    description?: string;
    preview?: string; // base64 thumbnail
    // Whapi may also send these aliases
    canonical_url?: string;
    thumbnail?: string;
  };
  from_name?: string;
  chat_id: string;
  context?: {
    quoted_id?: string;
    quoted_author?: string;
    quoted_content?: { body?: string };
    quoted_type?: string;
  };
}

export interface WhapiStatusUpdate {
  id: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed' | 'deleted';
  code?: number; // 0=failed, 1=pending, 2=sent, 3=delivered, 4=read, 5=played, 6=deleted
  timestamp: number;
  chat_id?: string;
  recipient_id?: string;
}
