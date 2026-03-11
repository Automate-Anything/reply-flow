-- ============================================================
-- MIGRATION 024: SESSION BOUNDARIES
-- Adds session ending support so conversations have real
-- start/end lifecycle. New inbound messages after a session
-- ends create a fresh session instead of reopening the old one.
-- Also adds configurable per-company inactivity timeout.
--
-- NOTE: Also backfills channel_id on chat_sessions if missing
-- (from migration 002 which was not applied to this database).
-- ============================================================

-- 0a. Add channel_id to chat_sessions if missing (from migration 002)
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS channel_id BIGINT REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL;

-- 0b. Backfill existing sessions with their user's channel
UPDATE public.chat_sessions cs
SET channel_id = (
  SELECT wc.id FROM public.whatsapp_channels wc
  WHERE wc.user_id = cs.user_id
  LIMIT 1
)
WHERE cs.channel_id IS NULL;

-- 0c. Add channel_id index if missing
CREATE INDEX IF NOT EXISTS idx_chat_sessions_channel
  ON public.chat_sessions(channel_id);

-- 1. Add ended_at to chat_sessions — marks when a session ended
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- 2. Add configurable session timeout to companies (default 24h)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS session_timeout_hours INTEGER NOT NULL DEFAULT 24;

-- 3. Drop old unique constraints (whichever one exists)
ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_user_id_chat_id_key;
ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_channel_id_chat_id_key;

-- 4. Partial unique index — only ONE active session per contact per channel
--    (active = ended_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_active_channel_chat_unique
  ON public.chat_sessions(channel_id, chat_id)
  WHERE ended_at IS NULL;

-- 5. Index for filtering ended sessions efficiently
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ended_at
  ON public.chat_sessions(ended_at)
  WHERE ended_at IS NOT NULL;

-- 6. Fix pre-existing schema inconsistency: status DEFAULT is 'active'
--    but CHECK constraint only allows open/pending/resolved/closed
ALTER TABLE public.chat_sessions
  ALTER COLUMN status SET DEFAULT 'open';
