-- ────────────────────────────────────────────────
-- 023_billing_trials.sql
-- Adds Stripe-based free-trial support:
--   • trial_ends_at — when the Stripe trial period expires (set from Stripe webhook)
--
-- Trials are now fully managed by Stripe (trial_period_days: 7 on checkout).
-- The subscription auto-converts to active after the trial; no separate "trial"
-- plan record is needed. Trial resource limits (1 channel / 1 agent / 100 messages
-- / 3 KB pages) are enforced server-side by checking status = 'trialing'.
-- ────────────────────────────────────────────────

-- Add trial_ends_at to track Stripe trial expiry
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Ensure 'trialing' is a valid status value
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'subscriptions'
      AND constraint_name = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_status_check;
  END IF;

  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'trialing', 'cancelled', 'past_due'));
END;
$$;
