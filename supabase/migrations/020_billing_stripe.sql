-- ============================================================
-- MIGRATION 020: BILLING - STRIPE INTEGRATION
-- Adds Stripe price ID to plans and Stripe subscription/customer
-- IDs to subscriptions so Stripe can manage the lifecycle.
-- ============================================================

-- Stripe price IDs live on the plan (update after creating prices in Stripe)
ALTER TABLE public.plans ADD COLUMN stripe_price_id TEXT;

-- Populated by the Stripe webhook when checkout completes or subscription changes
ALTER TABLE public.subscriptions
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN stripe_subscription_id TEXT;

-- ============================================================
-- After creating recurring prices in your Stripe dashboard,
-- run these UPDATEs to link them to the plans:
--
-- UPDATE public.plans SET stripe_price_id = 'price_xxx' WHERE id = 'starter';
-- UPDATE public.plans SET stripe_price_id = 'price_xxx' WHERE id = 'pro';
-- UPDATE public.plans SET stripe_price_id = 'price_xxx' WHERE id = 'scale';
-- ============================================================
