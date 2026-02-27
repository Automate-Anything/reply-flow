-- ============================================================
-- Reply Flow — Per-Channel AI Profiles
-- Moves AI profile data from company_ai_profiles into
-- channel_agent_settings so each channel has its own full
-- AI profile. company_ai_profiles is kept as a default
-- template for new channels.
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Add profile columns to channel_agent_settings
-- ────────────────────────────────────────────────

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS max_tokens INTEGER DEFAULT 500;

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'always_on';

ALTER TABLE public.channel_agent_settings
  ADD CONSTRAINT channel_agent_settings_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom'));

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS ai_schedule JSONB DEFAULT NULL;

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS outside_hours_message TEXT DEFAULT NULL;

-- ────────────────────────────────────────────────
-- 2. Migrate existing data from company_ai_profiles
--    into channel_agent_settings rows
-- ────────────────────────────────────────────────

UPDATE public.channel_agent_settings cas
SET
  profile_data          = COALESCE(cap.profile_data, '{}'::jsonb),
  max_tokens            = COALESCE(cas.max_tokens_override, cap.max_tokens, 500),
  schedule_mode         = COALESCE(cap.schedule_mode, 'always_on'),
  ai_schedule           = cap.ai_schedule,
  outside_hours_message = cap.outside_hours_message
FROM public.company_ai_profiles cap
WHERE cas.company_id = cap.company_id;

-- ────────────────────────────────────────────────
-- 3. Create settings rows for channels that lack them
-- ────────────────────────────────────────────────

INSERT INTO public.channel_agent_settings (
  channel_id, company_id, is_enabled,
  profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message
)
SELECT
  wc.id,
  wc.company_id,
  COALESCE(cap.is_enabled, true),
  COALESCE(cap.profile_data, '{}'::jsonb),
  COALESCE(cap.max_tokens, 500),
  COALESCE(cap.schedule_mode, 'always_on'),
  cap.ai_schedule,
  cap.outside_hours_message
FROM public.whatsapp_channels wc
LEFT JOIN public.company_ai_profiles cap ON cap.company_id = wc.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.channel_agent_settings cas WHERE cas.channel_id = wc.id
);

-- ────────────────────────────────────────────────
-- 4. Drop deprecated override columns
-- ────────────────────────────────────────────────

ALTER TABLE public.channel_agent_settings
  DROP COLUMN IF EXISTS greeting_override;

ALTER TABLE public.channel_agent_settings
  DROP COLUMN IF EXISTS max_tokens_override;
