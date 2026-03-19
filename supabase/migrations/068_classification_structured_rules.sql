-- 068_classification_structured_rules.sql
-- Add structured rules support and company/per-channel mode toggle

-- 1. Add config mode to companies (company-wide vs per-channel)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_config_mode TEXT NOT NULL DEFAULT 'company'
    CHECK (classification_config_mode IN ('company', 'per_channel'));

-- 2. Add structured rules JSONB to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_structured_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Add structured rules JSONB to channel_agent_settings
ALTER TABLE channel_agent_settings
  ADD COLUMN IF NOT EXISTS classification_structured_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
