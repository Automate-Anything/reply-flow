-- ============================================================
-- Reply Flow — Profile Sections Refactor
-- Moves default_language and business_hours from the companies
-- table into channel_agent_settings so each channel owns its
-- full schedule configuration.
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Add columns to channel_agent_settings
-- ────────────────────────────────────────────────

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS default_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT NULL;

-- ────────────────────────────────────────────────
-- 2. Migrate existing values from companies table
-- ────────────────────────────────────────────────

UPDATE public.channel_agent_settings cas
SET
  default_language = COALESCE(c.default_language, 'en'),
  business_hours   = c.business_hours
FROM public.whatsapp_channels wc
JOIN public.companies c ON c.id = wc.company_id
WHERE cas.channel_id = wc.id;
