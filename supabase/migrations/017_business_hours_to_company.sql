-- ============================================================
-- Reply Flow — Move Business Hours to Company Level
-- Migrates business_hours from channel_agent_settings back to
-- the companies table (which already has the column from 009).
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Migrate non-null business_hours from channel_agent_settings
--    back to companies (take the first non-null per company)
-- ────────────────────────────────────────────────

UPDATE public.companies c
SET business_hours = sub.business_hours
FROM (
  SELECT DISTINCT ON (wc.company_id)
    wc.company_id,
    cas.business_hours
  FROM public.channel_agent_settings cas
  JOIN public.whatsapp_channels wc ON wc.id = cas.channel_id
  WHERE cas.business_hours IS NOT NULL
  ORDER BY wc.company_id, cas.updated_at DESC
) sub
WHERE c.id = sub.company_id
  AND c.business_hours IS NULL;

-- ────────────────────────────────────────────────
-- 2. Drop business_hours column from channel_agent_settings
-- ────────────────────────────────────────────────

ALTER TABLE public.channel_agent_settings
  DROP COLUMN IF EXISTS business_hours;
