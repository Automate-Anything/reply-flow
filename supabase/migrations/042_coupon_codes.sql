-- Migration: 042_coupon_codes
-- Creates a coupon_codes table for managing promotional codes.
-- Each row maps an internal code (what users type) to a Stripe Coupon ID.

CREATE TABLE coupon_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT        UNIQUE NOT NULL,           -- e.g. 'WELCOME20'
  stripe_coupon_id TEXT   NOT NULL,                  -- Stripe Coupon ID (from Stripe dashboard)
  description TEXT,                                  -- Admin-facing notes, e.g. '20% off first month'
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No RLS: table is read server-side only (via service role key).
-- Admins manage rows directly via Supabase dashboard or SQL.
