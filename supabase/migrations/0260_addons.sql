-- ────────────────────────────────────────────────
-- 026_addons.sql
-- Introduces purchasable add-ons: extra WhatsApp channels ($15/mo)
-- and extra AI agents ($5/mo), billed as Stripe subscription items.
-- ────────────────────────────────────────────────

-- ============================================================
-- STEP 1: addon_products — catalogue of available add-ons
-- Set stripe_price_id manually after creating prices in Stripe
-- (same pattern as plans.stripe_price_id).
-- ============================================================
CREATE TABLE public.addon_products (
  id                   TEXT PRIMARY KEY,          -- 'extra_channel', 'extra_agent'
  name                 TEXT NOT NULL,
  description          TEXT,
  price_monthly_cents  INTEGER NOT NULL,
  stripe_price_id      TEXT,                      -- set after creating Stripe price
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.addon_products ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read active addon products
CREATE POLICY "Authenticated users can read addon products"
  ON public.addon_products FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = TRUE);

-- Seed the two add-ons (stripe_price_id set separately after Stripe setup)
INSERT INTO public.addon_products (id, name, description, price_monthly_cents) VALUES
  ('extra_channel', 'Extra WhatsApp Channel', 'Add an additional WhatsApp channel to your plan', 1500),
  ('extra_agent',   'Extra AI Agent',         'Add an additional AI agent to your plan',          500);

-- ============================================================
-- STEP 2: company_addons — purchased add-ons per company
-- ============================================================
CREATE TABLE public.company_addons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  addon_id                    TEXT NOT NULL REFERENCES public.addon_products(id),
  quantity                    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  stripe_subscription_item_id TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, addon_id)
);

ALTER TABLE public.company_addons ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.company_addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_company_addons_company ON public.company_addons(company_id);

-- Company members can view their add-ons
CREATE POLICY "Company members can view their addons"
  ON public.company_addons FOR SELECT
  USING (company_id = public.get_user_company_id());

-- Owners and admins can manage add-ons
CREATE POLICY "Company owners and admins can manage addons"
  ON public.company_addons FOR ALL
  USING (
    company_id = public.get_user_company_id()
    AND public.get_user_role_name() IN ('owner', 'admin')
  );
