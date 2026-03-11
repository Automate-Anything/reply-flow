-- ────────────────────────────────────────────────
-- 025_has_used_trial.sql
-- Adds has_used_trial to companies so we can permanently record whether a
-- company has ever started a free trial, independent of subscription lifecycle.
-- ────────────────────────────────────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN NOT NULL DEFAULT FALSE;
