export interface ChatSession {
  id: string;
  user_id: string;
  channel_id: number | null;
  contact_id: string | null;
  chat_id: string;
  phone_number: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
  human_takeover: boolean;
  auto_resume_at: string | null;
  status: string;
  is_archived: boolean;
  last_read_at: string | null;
  marked_unread: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string | null;
  user_id: string;
  chat_id_normalized: string | null;
  phone_number: string | null;
  message_body: string | null;
  message_type: string;
  message_id_normalized: string | null;
  direction: string | null;
  sender_type: 'ai' | 'human' | 'contact';
  status: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  message_ts: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  tags: string[];
  whatsapp_name: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}
