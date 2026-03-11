-- ============================================================
-- Reply Flow - Channel AI contact filtering
-- Adds per-channel AI mode and contact allow/block lists.
-- ============================================================

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS response_mode TEXT NOT NULL DEFAULT 'live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'channel_agent_settings_response_mode_check'
  ) THEN
    ALTER TABLE public.channel_agent_settings
      ADD CONSTRAINT channel_agent_settings_response_mode_check
      CHECK (response_mode IN ('live', 'test'));
  END IF;
END $$;

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS test_contact_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS excluded_contact_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];
