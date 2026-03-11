-- ============================================================
-- Reply Flow - Channel AI schedule configured flag
-- Tracks whether the per-channel AI schedule was explicitly saved.
-- ============================================================

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS schedule_configured BOOLEAN NOT NULL DEFAULT FALSE;
