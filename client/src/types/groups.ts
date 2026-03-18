export interface GroupChat {
  id: string;
  company_id: string;
  channel_id: number;
  group_jid: string;
  group_name: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
  channel_name?: string;
  criteria_count?: number;
}

export interface GroupChatMessage {
  id: string;
  group_chat_id: string;
  whatsapp_message_id: string;
  sender_phone: string | null;
  sender_name: string | null;
  message_body: string | null;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface GroupCriteria {
  id: string;
  company_id?: string;
  group_chat_id: string | null;
  rule_group_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertRule {
  id: string;
  rule_group_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  scope: string[] | null;
  scope_names?: string[];
  created_at: string;
}

export interface GroupCriteriaMatch {
  id: string;
  company_id?: string;
  group_chat_message_id: string;
  criteria_ids: string[];
  notification_ids?: string[];
  created_at: string;
  group_chat_messages?: GroupChatMessage;
}

export interface SyncResult {
  groups: GroupChat[];
  new_count: number;
  errors: Array<{ channel_id: number; error: string }>;
}
