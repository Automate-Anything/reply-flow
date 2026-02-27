-- ============================================================
-- Reply Flow — Remove Workspaces Layer
-- Flattens Company → Workspaces → Channels to Company → Channels.
-- AI profiles become company-scoped (one per company).
-- business_hours and default_language move to companies table.
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Add default_language and business_hours to companies
-- ────────────────────────────────────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT NULL;

-- Migrate data from each company's first workspace (by created_at)
UPDATE public.companies c
SET
  default_language = COALESCE(w.default_language, 'en'),
  business_hours   = w.business_hours
FROM (
  SELECT DISTINCT ON (company_id)
    company_id, default_language, business_hours
  FROM public.workspaces
  ORDER BY company_id, created_at ASC
) w
WHERE c.id = w.company_id;

-- ────────────────────────────────────────────────
-- 2. Deduplicate workspace_ai_profiles → one per company
--    Keep the enabled profile (prefer enabled=true), or oldest.
-- ────────────────────────────────────────────────

-- Delete duplicate profiles, keeping the best one per company
DELETE FROM public.workspace_ai_profiles
WHERE id NOT IN (
  SELECT DISTINCT ON (company_id) id
  FROM public.workspace_ai_profiles
  ORDER BY company_id, is_enabled DESC, created_at ASC
);

-- ────────────────────────────────────────────────
-- 3. Drop workspace_id FK from whatsapp_channels
-- ────────────────────────────────────────────────

-- Drop the index first
DROP INDEX IF EXISTS public.idx_whatsapp_channels_workspace;

-- Drop the FK constraint (name from migration 005)
ALTER TABLE public.whatsapp_channels
  DROP CONSTRAINT IF EXISTS whatsapp_channels_workspace_id_fkey;

-- Drop the column
ALTER TABLE public.whatsapp_channels
  DROP COLUMN IF EXISTS workspace_id;

-- ────────────────────────────────────────────────
-- 4. Transform workspace_ai_profiles → company_ai_profiles
-- ────────────────────────────────────────────────

-- Drop existing RLS policies on workspace_ai_profiles
DROP POLICY IF EXISTS "Company members can view workspace ai profiles" ON public.workspace_ai_profiles;
DROP POLICY IF EXISTS "Authorized users can create workspace ai profiles" ON public.workspace_ai_profiles;
DROP POLICY IF EXISTS "Authorized users can update workspace ai profiles" ON public.workspace_ai_profiles;
DROP POLICY IF EXISTS "Authorized users can delete workspace ai profiles" ON public.workspace_ai_profiles;

-- Drop the unique constraint on workspace_id
ALTER TABLE public.workspace_ai_profiles
  DROP CONSTRAINT IF EXISTS workspace_ai_profiles_workspace_id_key;

-- Drop workspace_id index
DROP INDEX IF EXISTS public.idx_workspace_ai_profiles_workspace;

-- Drop the workspace_id FK
ALTER TABLE public.workspace_ai_profiles
  DROP CONSTRAINT IF EXISTS workspace_ai_profiles_workspace_id_fkey;

-- Drop workspace_id column
ALTER TABLE public.workspace_ai_profiles
  DROP COLUMN IF EXISTS workspace_id;

-- Add unique constraint on company_id
ALTER TABLE public.workspace_ai_profiles
  ADD CONSTRAINT company_ai_profiles_company_id_key UNIQUE (company_id);

-- Rename table
ALTER TABLE public.workspace_ai_profiles RENAME TO company_ai_profiles;

-- ────────────────────────────────────────────────
-- 5. Drop workspace_id from knowledge_base_entries
--    (migration 005 attempted this but it may not have taken effect)
-- ────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_kb_entries_workspace;

ALTER TABLE public.knowledge_base_entries
  DROP CONSTRAINT IF EXISTS knowledge_base_entries_workspace_id_fkey;

ALTER TABLE public.knowledge_base_entries
  DROP COLUMN IF EXISTS workspace_id;

-- ────────────────────────────────────────────────
-- 6. Drop workspaces table
-- ────────────────────────────────────────────────

-- Drop RLS policies on workspaces
DROP POLICY IF EXISTS "Company members can view workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authorized users can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authorized users can update workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Authorized users can delete workspaces" ON public.workspaces;

-- Drop trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.workspaces;

-- Drop index
DROP INDEX IF EXISTS public.idx_workspaces_company;

-- Drop the table
DROP TABLE IF EXISTS public.workspaces;

-- ────────────────────────────────────────────────
-- 7. Create RLS policies for company_ai_profiles
-- ────────────────────────────────────────────────

ALTER TABLE public.company_ai_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view company ai profiles"
  ON public.company_ai_profiles FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'view')
  );

CREATE POLICY "Authorized users can create company ai profiles"
  ON public.company_ai_profiles FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can update company ai profiles"
  ON public.company_ai_profiles FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can delete company ai profiles"
  ON public.company_ai_profiles FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

-- ────────────────────────────────────────────────
-- 8. Clean up workspace permissions from role_permissions
-- ────────────────────────────────────────────────

DELETE FROM public.role_permissions WHERE resource = 'workspaces';
