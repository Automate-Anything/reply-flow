-- ============================================================
-- MIGRATION 019: BILLING - PLANS & SUBSCRIPTIONS
-- Introduces plans table (plan definitions) and subscriptions
-- table (company → plan assignment with billing period).
-- ============================================================

-- ============================================================
-- STEP 1: CREATE plans TABLE
-- ============================================================
CREATE TABLE public.plans (
  id                     TEXT PRIMARY KEY,          -- 'starter', 'pro', 'scale'
  name                   TEXT NOT NULL,
  price_monthly_cents    INTEGER NOT NULL,           -- e.g. 2900 = $29.00
  channels               INTEGER NOT NULL,
  agents                 INTEGER NOT NULL,
  knowledge_bases        INTEGER NOT NULL,
  kb_pages               INTEGER NOT NULL,          -- included KB pages (1 page = 2000 tokens)
  messages_per_month     INTEGER NOT NULL,
  overage_message_cents  INTEGER NOT NULL,           -- per extra message
  overage_page_cents     INTEGER NOT NULL,           -- per extra KB page
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the three plans
INSERT INTO public.plans (id, name, price_monthly_cents, channels, agents, knowledge_bases, kb_pages, messages_per_month, overage_message_cents, overage_page_cents) VALUES
  ('starter', 'Starter',  2900, 1, 1,  1,   5,  500, 3, 5),
  ('pro',     'Pro',      5900, 2, 3,  5,  50, 1000, 2, 4),
  ('scale',   'Scale',    9900, 3, 5, 10, 200, 2000, 2, 3);

-- ============================================================
-- STEP 2: CREATE subscriptions TABLE
-- ============================================================
CREATE TABLE public.subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id               TEXT NOT NULL REFERENCES public.plans(id),
  status                TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'cancelled' | 'past_due'
                          CHECK (status IN ('active', 'cancelled', 'past_due')),
  current_period_start  DATE NOT NULL DEFAULT CURRENT_DATE,
  current_period_end    DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_subscriptions_company ON public.subscriptions(company_id);

-- ============================================================
-- STEP 3: RLS POLICIES FOR subscriptions
-- ============================================================
CREATE POLICY "Company members can view their subscription"
  ON public.subscriptions FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Company owners and admins can manage subscription"
  ON public.subscriptions FOR ALL
  USING (company_id = public.get_user_company_id());
