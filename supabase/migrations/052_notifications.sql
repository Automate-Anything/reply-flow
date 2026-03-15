-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'assignment', 'share',
    'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note'
  )),
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC)
  WHERE is_read = false;
CREATE INDEX idx_notifications_user_recent ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_company ON notifications (company_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (
  user_id = auth.uid()
);
-- Insert is server-side only (supabaseAdmin), no RLS policy needed for insert
-- Delete own notifications
CREATE POLICY notifications_delete ON notifications FOR DELETE USING (
  user_id = auth.uid()
);

-- Notification preferences table
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY notification_preferences_upsert ON notification_preferences FOR ALL USING (
  user_id = auth.uid()
);

-- Enable realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
