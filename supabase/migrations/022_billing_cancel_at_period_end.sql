-- ============================================================
-- MIGRATION 022: BILLING - CANCEL AT PERIOD END
-- Tracks whether a subscription is scheduled to cancel at the
-- end of the current billing period (set by Stripe).
-- ============================================================

ALTER TABLE public.subscriptions
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
