-- Add 'handoff' to the notifications type CHECK constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assignment', 'share',
  'message_assigned', 'message_accessible',
  'snooze_set', 'schedule_set', 'schedule_sent',
  'status_change', 'contact_note',
  'handoff'
));

-- Update default preferences to include handoff (enabled by default)
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
    "handoff": true
  }'::jsonb;
