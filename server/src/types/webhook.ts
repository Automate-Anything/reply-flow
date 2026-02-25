// Whapi webhook payload for incoming messages
export interface WhapiWebhookPayload {
  messages?: WhapiIncomingMessage[];
  statuses?: WhapiStatusUpdate[];
}

export interface WhapiIncomingMessage {
  id: string;
  from: string;
  to: string;
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
  };
  video?: {
    id: string;
    mime_type: string;
    caption?: string;
    link?: string;
  };
  from_name?: string;
  chat_id: string;
}

export interface WhapiStatusUpdate {
  id: string;
  status: string;
  timestamp: number;
  chat_id: string;
}
