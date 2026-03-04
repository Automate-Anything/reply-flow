-- ============================================================
-- MIGRATION 018: KNOWLEDGE BASE GROUPS
-- Introduces knowledge_bases as parent containers for entries.
-- Each company can have multiple KBs, each with multiple entries.
-- KB assignment moves from channel-level to scenario-level (in profile_data JSON).
-- ============================================================

-- ============================================================
-- STEP 1: CREATE knowledge_bases TABLE
-- ============================================================
CREATE TABLE public.knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_knowledge_bases_company ON public.knowledge_bases(company_id);

-- ============================================================
-- STEP 2: RLS POLICIES FOR knowledge_bases
-- ============================================================
CREATE POLICY "Company members can view knowledge bases"
  ON public.knowledge_bases FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'view')
  );

CREATE POLICY "Authorized users can create knowledge bases"
  ON public.knowledge_bases FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'create')
  );

CREATE POLICY "Authorized users can update knowledge bases"
  ON public.knowledge_bases FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'edit')
  );

CREATE POLICY "Authorized users can delete knowledge bases"
  ON public.knowledge_bases FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'delete')
  );

-- ============================================================
-- STEP 3: ADD knowledge_base_id TO knowledge_base_entries
-- ============================================================
ALTER TABLE public.knowledge_base_entries
  ADD COLUMN knowledge_base_id UUID REFERENCES public.knowledge_bases(id) ON DELETE CASCADE;

CREATE INDEX idx_kb_entries_knowledge_base ON public.knowledge_base_entries(knowledge_base_id);

-- ============================================================
-- STEP 4: MIGRATE EXISTING DATA
-- Create a "Default" KB for each company that has entries
-- ============================================================
INSERT INTO public.knowledge_bases (id, company_id, name, description)
SELECT DISTINCT
  gen_random_uuid(),
  kbe.company_id,
  'Default',
  'Default knowledge base (migrated from existing entries)'
FROM public.knowledge_base_entries kbe
WHERE kbe.company_id IS NOT NULL
ON CONFLICT (company_id, name) DO NOTHING;

-- Assign existing entries to their company's Default KB
UPDATE public.knowledge_base_entries kbe
SET knowledge_base_id = kb.id
FROM public.knowledge_bases kb
WHERE kb.company_id = kbe.company_id
  AND kb.name = 'Default'
  AND kbe.knowledge_base_id IS NULL;

-- Make knowledge_base_id NOT NULL
ALTER TABLE public.knowledge_base_entries
  ALTER COLUMN knowledge_base_id SET NOT NULL;

-- ============================================================
-- STEP 5: DROP channel_kb_assignments TABLE
-- (KB assignment is now scenario-based via profile_data JSON)
-- ============================================================
DROP TABLE IF EXISTS public.channel_kb_assignments CASCADE;
