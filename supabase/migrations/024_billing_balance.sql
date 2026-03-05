-- ────────────────────────────────────────────────
-- 024_billing_balance.sql
-- Adds:
--   • company_balances table — prepaid overage credit balance + auto top-up config (one row per company)
--   • balance_transactions table — immutable audit log of credits and debits
--   • first_paid_at, renewal_failed_at, grace_period_ends_at columns on subscriptions
--   • deduct_message_balance() Postgres function for atomic balance deduction
-- ────────────────────────────────────────────────

-- ── 1. subscriptions: billing lifecycle columns ──────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS first_paid_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_failed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- ── 2. company_balances ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_balances (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  balance_cents               INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  auto_topup_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  auto_topup_threshold_cents  INTEGER CHECK (auto_topup_threshold_cents > 0),
  auto_topup_amount_cents     INTEGER CHECK (auto_topup_amount_cents >= 500), -- minimum $5
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.company_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_view_balance"
  ON public.company_balances FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "company_owners_update_balance"
  ON public.company_balances FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ── 3. balance_transactions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.balance_transactions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount_cents             INTEGER NOT NULL,  -- positive = credit, negative = debit
  type                     TEXT NOT NULL,
  description              TEXT,
  stripe_payment_intent_id TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT balance_transactions_type_check
    CHECK (type IN ('topup_manual', 'topup_auto', 'overage_message', 'refund'))
);

-- RLS
ALTER TABLE public.balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_view_transactions"
  ON public.balance_transactions FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- Index for efficient per-company lookups
CREATE INDEX IF NOT EXISTS balance_transactions_company_idx
  ON public.balance_transactions (company_id, created_at DESC);

-- ── 4. deduct_message_balance() ──────────────────────────────────────────────
-- Atomically deducts overage cost from company_balances.
-- Creates the balance row if it doesn't exist yet (balance stays 0 in that case).
-- Inserts a debit row in balance_transactions.
-- Returns the new balance.

CREATE OR REPLACE FUNCTION public.deduct_message_balance(
  p_company_id   UUID,
  p_amount_cents INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  -- Upsert the balance row, deducting amount but flooring at 0
  INSERT INTO public.company_balances (company_id, balance_cents)
  VALUES (p_company_id, 0)
  ON CONFLICT (company_id) DO NOTHING;

  UPDATE public.company_balances
  SET
    balance_cents = GREATEST(0, balance_cents - p_amount_cents),
    updated_at    = NOW()
  WHERE company_id = p_company_id
  RETURNING balance_cents INTO v_new_balance;

  -- Record the debit
  INSERT INTO public.balance_transactions (company_id, amount_cents, type, description)
  VALUES (p_company_id, -p_amount_cents, 'overage_message', 'AI message overage deduction');

  RETURN v_new_balance;
END;
$$;

-- ── 5. credit_company_balance() ──────────────────────────────────────────────
-- Atomically adds credits to a company's balance.
-- Creates the balance row if it doesn't exist yet.
-- Inserts an audit row in balance_transactions.

CREATE OR REPLACE FUNCTION public.credit_company_balance(
  p_company_id    UUID,
  p_amount_cents  INTEGER,
  p_type          TEXT,           -- 'topup_manual' | 'topup_auto' | 'refund'
  p_description   TEXT DEFAULT NULL,
  p_stripe_pi_id  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
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
