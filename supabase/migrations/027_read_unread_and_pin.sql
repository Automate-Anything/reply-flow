-- ============================================================
-- MIGRATION 027: READ/UNREAD WIRING & PIN CONVERSATIONS
-- Adds pinned_at timestamp to chat_sessions for pinning (max 3).
-- marked_unread already exists from migration 007; no schema
-- change needed for it — only server + frontend wiring.
-- ============================================================

-- 1. Add pinned_at column (nullable = not pinned)
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- 2. Partial index for efficient sorting / filtering of pinned conversations
CREATE INDEX IF NOT EXISTS idx_chat_sessions_pinned
  ON public.chat_sessions(company_id, pinned_at)
  WHERE pinned_at IS NOT NULL;
