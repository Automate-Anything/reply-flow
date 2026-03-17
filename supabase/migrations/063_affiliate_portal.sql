-- Enable moddatetime extension if not already enabled
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- Commission schedule templates
CREATE TABLE commission_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage', 'flat')),
  end_behavior TEXT NOT NULL CHECK (end_behavior IN ('stop', 'continue_last', 'custom_rate')),
  end_rate NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (end_behavior != 'custom_rate') OR
    (end_behavior = 'custom_rate' AND end_rate IS NOT NULL)
  )
);

-- Schedule periods
CREATE TABLE commission_schedule_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES commission_schedules(id) ON DELETE CASCADE,
  from_payment INT NOT NULL,
  to_payment INT NOT NULL,
  rate NUMERIC NOT NULL,
  CHECK (from_payment >= 1),
  CHECK (to_payment >= from_payment)
);

-- Core affiliate accounts
CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  affiliate_code TEXT UNIQUE NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (approval_status IN ('pending_review', 'approved', 'rejected')),
  stripe_connect_account_id TEXT,
  bank_account_added BOOLEAN DEFAULT false,
  commission_schedule_id UUID REFERENCES commission_schedules(id),
  commission_type TEXT CHECK (commission_type IN ('percentage', 'flat')),
  commission_rate NUMERIC,
  refresh_token TEXT,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Affiliate referrals
CREATE TABLE affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'trialing', 'active', 'churned')),
  payment_count INT DEFAULT 0,
  last_plan_name TEXT,
  commission_schedule_id UUID REFERENCES commission_schedules(id),
  schedule_override_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payout records
CREATE TABLE affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_cents INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_transfer_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Commission events
CREATE TABLE commission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_id UUID NOT NULL REFERENCES affiliate_referrals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('signup', 'renewal', 'upgrade', 'downgrade', 'churn')),
  payment_number INT NOT NULL,
  plan_name TEXT,
  invoice_amount_cents INT NOT NULL,
  commission_amount_cents INT NOT NULL,
  stripe_invoice_id TEXT,
  payout_id UUID REFERENCES affiliate_payouts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign links
CREATE TABLE affiliate_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  total_clicks INT DEFAULT 0,
  total_signups INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notification preferences
CREATE TABLE affiliate_notification_preferences (
  affiliate_id UUID PRIMARY KEY REFERENCES affiliates(id) ON DELETE CASCADE,
  new_referral BOOLEAN DEFAULT true,
  referral_converted BOOLEAN DEFAULT true,
  commission_earned BOOLEAN DEFAULT true,
  payout_processed BOOLEAN DEFAULT true
);

-- Terms & conditions
CREATE TABLE affiliate_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  terms_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agreement acceptances
CREATE TABLE affiliate_agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES affiliate_agreements(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ DEFAULT now()
);

-- Click log for deduplication
CREATE TABLE affiliate_click_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES affiliate_campaigns(id),
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payout settings (singleton)
CREATE TABLE payout_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid),
  min_payout_cents INT DEFAULT 2500,
  payout_day_of_month INT DEFAULT 1 CHECK (payout_day_of_month BETWEEN 1 AND 28),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the singleton payout settings row
INSERT INTO payout_settings (id) VALUES ('00000000-0000-0000-0000-000000000001');

-- Indexes
CREATE INDEX idx_affiliate_referrals_company_id ON affiliate_referrals(company_id);
CREATE INDEX idx_affiliate_referrals_affiliate_id ON affiliate_referrals(affiliate_id);
CREATE INDEX idx_commission_events_referral_id ON commission_events(referral_id);
CREATE INDEX idx_commission_events_affiliate_id ON commission_events(affiliate_id);
CREATE INDEX idx_commission_events_payout_id ON commission_events(payout_id);
CREATE INDEX idx_affiliate_campaigns_affiliate_id ON affiliate_campaigns(affiliate_id);
CREATE INDEX idx_affiliate_click_log_dedup ON affiliate_click_log(affiliate_id, ip_hash, created_at);
CREATE INDEX idx_commission_schedule_periods_schedule_id ON commission_schedule_periods(schedule_id);
CREATE INDEX idx_affiliates_approval_status ON affiliates(approval_status);
CREATE INDEX idx_affiliate_payouts_affiliate_status ON affiliate_payouts(affiliate_id, status);
