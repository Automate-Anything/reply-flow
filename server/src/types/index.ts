export interface ChatSession {
  id: string;
  user_id: string;
  company_id: string;
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
  company_id: string;
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
  company_id: string;
  created_by: string | null;
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
  company_id: string;
  created_by: string | null;
  name: string;
  color: string;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  hierarchy_level: number;
  created_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role_id: string;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  company_id: string;
  role_id: string;
  resource: string;
  action: string;
}

export interface GroupChat {
  id: string;
  company_id: string;
  channel_id: number;
  group_jid: string;
  group_name: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupChatMessage {
  id: string;
  company_id: string;
  group_chat_id: string;
  whatsapp_message_id: string;
  sender_phone: string | null;
  sender_name: string | null;
  message_body: string | null;
  message_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GroupCriteria {
  id: string;
  company_id: string;
  group_chat_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: {
    keywords?: string[];
    operator?: 'and' | 'or';
  };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupCriteriaMatch {
  id: string;
  company_id: string;
  group_chat_message_id: string;
  criteria_ids: string[];
  notification_ids: string[];
  created_at: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role_id: string;
  token: string;
  invited_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface ClassificationSuggestionItem {
  id: string;
  confidence: number;
  name?: string;
}

export interface ClassificationSuggestions {
  labels?: ClassificationSuggestionItem[];
  priority?: ClassificationSuggestionItem;
  status?: ClassificationSuggestionItem;
  contact_tags?: ClassificationSuggestionItem[];
  contact_lists?: ClassificationSuggestionItem[];
  reasoning: string;
}

export interface ClassificationSuggestion {
  id: string;
  company_id: string;
  session_id: string;
  contact_id: string;
  trigger: 'auto' | 'manual';
  status: 'pending' | 'accepted' | 'dismissed' | 'applied';
  suggestions: ClassificationSuggestions;
  accepted_items: Partial<ClassificationSuggestions> | null;
  applied_by: string | null;
  created_at: string;
  applied_at: string | null;
  updated_at: string;
}

export interface ClassificationConfig {
  enabled: boolean;
  rules: string;
  auto_classify_new: boolean;
}

export interface PartialAccept {
  labels?: string[];
  priority?: boolean;
  status?: boolean;
  contact_tags?: string[];
  contact_lists?: string[];
}
