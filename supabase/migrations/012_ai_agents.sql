-- ============================================================
-- Reply Flow — AI Agents as First-Class Entities
-- Creates ai_agents table, adds agent_id FK to
-- channel_agent_settings, migrates existing data.
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Create ai_agents table
-- ────────────────────────────────────────────────

CREATE TABLE public.ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'AI Agent',
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_agents_company ON public.ai_agents(company_id);

-- ────────────────────────────────────────────────
-- 2. Add agent_id FK to channel_agent_settings
--    (nullable for backward compat)
-- ────────────────────────────────────────────────

ALTER TABLE public.channel_agent_settings
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────
-- 3. Migrate: create one agent per company from
--    company_ai_profiles data, then link existing
--    channels to that agent
-- ────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  new_agent_id UUID;
BEGIN
  FOR r IN SELECT * FROM public.company_ai_profiles LOOP
    INSERT INTO public.ai_agents (company_id, name, profile_data, created_by)
    VALUES (r.company_id, 'Default Agent', COALESCE(r.profile_data, '{}'::jsonb), r.created_by)
    RETURNING id INTO new_agent_id;

    UPDATE public.channel_agent_settings
    SET agent_id = new_agent_id
    WHERE company_id = r.company_id;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────
-- 4. Enable RLS
-- ────────────────────────────────────────────────

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_agents_company_access" ON public.ai_agents
  USING (company_id = public.get_user_company_id());
