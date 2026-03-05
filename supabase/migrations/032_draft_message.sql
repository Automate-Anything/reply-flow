-- ============================================================
-- MIGRATION 031: DRAFT MESSAGE PERSISTENCE
-- Adds a draft_message text column to chat_sessions so that
-- in-progress message drafts survive conversation switches,
-- page refreshes, and device changes.
-- ============================================================

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS draft_message TEXT;
