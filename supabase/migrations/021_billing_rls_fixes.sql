-- ============================================================
-- MIGRATION 021: BILLING RLS FIXES
-- Adds missing RLS to plans table and tightens the subscriptions
-- manage policy to owners and admins only.
-- ============================================================

-- ============================================================
-- STEP 1: ENABLE RLS ON plans + ADD SELECT POLICY
-- ============================================================
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Plans are a global lookup table; any authenticated user may read them.
-- Writes are handled exclusively via service_role (migrations/admin).
CREATE POLICY "Authenticated users can read plans"
  ON public.plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ============================================================
-- STEP 2: TIGHTEN subscriptions MANAGE POLICY
-- ============================================================
DROP POLICY IF EXISTS "Company owners and admins can manage subscription" ON public.subscriptions;

CREATE POLICY "Company owners and admins can manage subscription"
  ON public.subscriptions FOR ALL
  USING (
    company_id = public.get_user_company_id()
    AND public.get_user_role_name() IN ('owner', 'admin')
  );
