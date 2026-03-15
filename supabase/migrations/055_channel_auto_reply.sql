-- Add auto-reply columns to channel_agent_settings
-- Auto-reply fires when AI is OFF for the channel (different from outside_hours_message which fires when AI is ON but outside schedule)
ALTER TABLE channel_agent_settings
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reply_message TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_reply_trigger TEXT NOT NULL DEFAULT 'outside_hours'
    CHECK (auto_reply_trigger IN ('outside_hours', 'all_unavailable'));
