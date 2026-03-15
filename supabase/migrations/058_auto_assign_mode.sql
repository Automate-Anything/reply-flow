-- Add auto_assign_mode to companies
-- 'company' = one rule applies to all channels
-- 'per_channel' = each channel has its own rule, no company-wide fallback
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS auto_assign_mode TEXT NOT NULL DEFAULT 'company'
    CHECK (auto_assign_mode IN ('company', 'per_channel'));
