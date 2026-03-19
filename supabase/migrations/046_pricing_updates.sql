-- ============================================================
-- MIGRATION 046: PRICING UPDATES
-- 1. Convert overage columns to NUMERIC for sub-cent precision
-- 2. Convert balance columns & RPCs to NUMERIC for sub-cent deductions
-- 3. Update message overage rates (starter: 3.5¢, pro: 3¢, scale: 2.5¢)
-- 4. Add AI suggestions columns to plans table
-- 5. Add groups_monitoring addon products
-- ============================================================

-- ============================================================
-- STEP 1: Convert plan overage columns from INTEGER to NUMERIC
-- This allows sub-cent precision (e.g. 3.5 cents = $0.035).
-- ============================================================
ALTER TABLE public.plans
  ALTER COLUMN overage_message_cents TYPE NUMERIC(10,2) USING overage_message_cents::NUMERIC(10,2),
  ALTER COLUMN overage_page_cents    TYPE NUMERIC(10,2) USING overage_page_cents::NUMERIC(10,2);

-- ============================================================
-- STEP 2: Convert balance tables to NUMERIC so fractional-cent
-- deductions accumulate correctly
-- ============================================================
ALTER TABLE public.company_balances
  ALTER COLUMN balance_cents TYPE NUMERIC(12,2) USING balance_cents::NUMERIC(12,2);

ALTER TABLE public.balance_transactions
  ALTER COLUMN amount_cents TYPE NUMERIC(12,2) USING amount_cents::NUMERIC(12,2);

-- Re-create deduct_message_balance() to accept/return NUMERIC
CREATE OR REPLACE FUNCTION public.deduct_message_balance(
  p_company_id   UUID,
  p_amount_cents NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  INSERT INTO public.company_balances (company_id, balance_cents)
  VALUES (p_company_id, 0)
  ON CONFLICT (company_id) DO NOTHING;

  UPDATE public.company_balances
  SET
    balance_cents = GREATEST(0, balance_cents - p_amount_cents),
    updated_at    = NOW()
  WHERE company_id = p_company_id
  RETURNING balance_cents INTO v_new_balance;

  INSERT INTO public.balance_transactions (company_id, amount_cents, type, description)
  VALUES (p_company_id, -p_amount_cents, 'overage_message', 'AI message overage deduction');

  RETURN v_new_balance;
END;
$$;

-- Re-create credit_company_balance() to accept/return NUMERIC
CREATE OR REPLACE FUNCTION public.credit_company_balance(
  p_company_id    UUID,
  p_amount_cents  NUMERIC,
  p_type          TEXT,
  p_description   TEXT DEFAULT NULL,
  p_stripe_pi_id  TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  INSERT INTO public.company_balances (company_id, balance_cents)
  VALUES (p_company_id, p_amount_cents)
  ON CONFLICT (company_id) DO UPDATE
    SET
      balance_cents = public.company_balances.balance_cents + p_amount_cents,
      updated_at    = NOW()
  RETURNING balance_cents INTO v_new_balance;

  INSERT INTO public.balance_transactions
    (company_id, amount_cents, type, description, stripe_payment_intent_id)
  VALUES
    (p_company_id, p_amount_cents, p_type, p_description, p_stripe_pi_id);

  RETURN v_new_balance;
END;
$$;

-- ============================================================
-- STEP 3: Update message overage rates with exact sub-cent values
-- ============================================================
UPDATE public.plans SET overage_message_cents = 3.5 WHERE id = 'starter';  -- $0.035
UPDATE public.plans SET overage_message_cents = 3   WHERE id = 'pro';      -- $0.03
UPDATE public.plans SET overage_message_cents = 2.5 WHERE id = 'scale';    -- $0.025

-- ============================================================
-- STEP 4: Add AI suggestions columns to plans table (NUMERIC for sub-cent)
-- ============================================================
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS ai_suggestions_per_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overage_suggestion_cents  NUMERIC(10,2) NOT NULL DEFAULT 0;

UPDATE public.plans SET ai_suggestions_per_month = 50,  overage_suggestion_cents = 2.5 WHERE id = 'starter';  -- $0.025
UPDATE public.plans SET ai_suggestions_per_month = 150, overage_suggestion_cents = 2   WHERE id = 'pro';      -- $0.02
UPDATE public.plans SET ai_suggestions_per_month = 400, overage_suggestion_cents = 1.5 WHERE id = 'scale';    -- $0.015

-- ============================================================
-- STEP 5: Add Groups Monitoring add-on products
-- ============================================================
INSERT INTO public.addon_products (id, name, description, price_monthly_cents) VALUES
  ('groups_monitoring_basic', 'Groups Monitoring — Basic', '5 groups, 5,000 AI evaluations/mo', 800),
  ('groups_monitoring_pro',   'Groups Monitoring — Pro',   '15 groups, 15,000 AI evaluations/mo', 1800),
  ('groups_monitoring_scale', 'Groups Monitoring — Scale', '30 groups, 30,000 AI evaluations/mo', 3000)
ON CONFLICT (id) DO NOTHING;
