-- =============================================================
-- 063: Group Chat Criteria Alerts
-- Tables: group_chats, group_chat_messages, group_criteria, group_criteria_matches
-- =============================================================

-- 1. group_chats — discovered WhatsApp groups
CREATE TABLE IF NOT EXISTS group_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_name TEXT,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, group_jid)
);

ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_chats_company_isolation" ON group_chats
  FOR ALL USING (
    company_id = get_user_company_id()
  );

-- 2. group_chat_messages — messages from monitored groups
CREATE TABLE IF NOT EXISTS group_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT NOT NULL,
  sender_phone TEXT,
  sender_name TEXT,
  message_body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_chat_id, whatsapp_message_id)
);

ALTER TABLE group_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_chat_messages_company_isolation" ON group_chat_messages
  FOR ALL USING (
    company_id = get_user_company_id()
  );

-- Index for fetching messages by group (paginated by time)
CREATE INDEX idx_group_chat_messages_group_time
  ON group_chat_messages (group_chat_id, created_at DESC);

-- 3. group_criteria — configurable alert rules
CREATE TABLE IF NOT EXISTS group_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_id UUID REFERENCES group_chats(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('keyword', 'ai')),
  keyword_config JSONB DEFAULT '{}',
  ai_description TEXT,
  notify_user_ids UUID[] NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE group_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_criteria_company_isolation" ON group_criteria
  FOR ALL USING (
    company_id = get_user_company_id()
  );

-- Index for fetching criteria by group (including global where group_chat_id IS NULL)
CREATE INDEX idx_group_criteria_group ON group_criteria (group_chat_id);
CREATE INDEX idx_group_criteria_company ON group_criteria (company_id);

-- 4. group_criteria_matches — log of triggered criteria
CREATE TABLE IF NOT EXISTS group_criteria_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_message_id UUID NOT NULL REFERENCES group_chat_messages(id) ON DELETE CASCADE,
  criteria_ids UUID[] NOT NULL DEFAULT '{}',
  notification_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE group_criteria_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_criteria_matches_company_isolation" ON group_criteria_matches
  FOR ALL USING (
    company_id = get_user_company_id()
  );

CREATE INDEX idx_group_criteria_matches_message
  ON group_criteria_matches (group_chat_message_id);

-- 5. Add new notification type to the check constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'share', 'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note', 'handoff',
    'group_criteria_match'
  ));

-- 6. Update notification_preferences column default to include new type
ALTER TABLE notification_preferences
  ALTER COLUMN preferences SET DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true,
    "handoff": true,
    "group_criteria_match": true
  }'::jsonb;

-- 7. Enable realtime for group tables
ALTER PUBLICATION supabase_realtime ADD TABLE group_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE group_criteria_matches;
