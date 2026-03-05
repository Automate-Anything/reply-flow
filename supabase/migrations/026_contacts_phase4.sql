-- ============================================================
-- MIGRATION 026: CONTACTS PHASE 4
-- Duplicate detection (pg_trgm), activity log, merge tracking.
-- ============================================================

-- ============================================================
-- STEP 1: Enable pg_trgm for fuzzy name matching
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for name similarity queries
CREATE INDEX idx_contacts_first_name_trgm
  ON public.contacts USING GIN(first_name gin_trgm_ops)
  WHERE is_deleted = false;

CREATE INDEX idx_contacts_last_name_trgm
  ON public.contacts USING GIN(last_name gin_trgm_ops)
  WHERE is_deleted = false;

-- Email index for exact-match duplicate detection
CREATE INDEX idx_contacts_email
  ON public.contacts(email)
  WHERE is_deleted = false AND email IS NOT NULL;

-- ============================================================
-- STEP 2: contact_activity_log table
-- ============================================================

CREATE TABLE public.contact_activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_action CHECK (
    action IN (
      'created', 'edited', 'tag_added', 'tag_removed',
      'list_added', 'list_removed', 'imported', 'merged'
    )
  )
);

ALTER TABLE public.contact_activity_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contact_activity_log_contact
  ON public.contact_activity_log(contact_id);
CREATE INDEX idx_contact_activity_log_company
  ON public.contact_activity_log(company_id);
CREATE INDEX idx_contact_activity_log_created
  ON public.contact_activity_log(created_at DESC);

CREATE POLICY "Company members can view contact activity log"
  ON public.contact_activity_log FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create contact activity log"
  ON public.contact_activity_log FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 3: Add merged_into column to contacts
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN merged_into UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 4: Retroactively insert "created" events for existing contacts
-- ============================================================

INSERT INTO public.contact_activity_log (contact_id, company_id, user_id, action, metadata, created_at)
SELECT
  id, company_id, created_by, 'created', '{}', created_at
FROM public.contacts
WHERE is_deleted = false;

-- ============================================================
-- STEP 5: find_duplicate_contacts function
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_duplicate_contacts(p_company_id UUID)
RETURNS TABLE(
  contact_id_1 UUID,
  contact_id_2 UUID,
  match_type TEXT,
  confidence FLOAT
) AS $$
BEGIN
  -- Email exact matches (high confidence)
  RETURN QUERY
  SELECT DISTINCT ON (LEAST(c1.id, c2.id), GREATEST(c1.id, c2.id))
    c1.id, c2.id, 'email'::TEXT, 0.9::FLOAT
  FROM public.contacts c1
  JOIN public.contacts c2
    ON c1.email = c2.email
    AND c1.id < c2.id
    AND c1.company_id = c2.company_id
  WHERE c1.company_id = p_company_id
    AND c1.is_deleted = false
    AND c2.is_deleted = false
    AND c1.email IS NOT NULL
    AND c1.email != '';

  -- Name similarity matches (medium confidence)
  RETURN QUERY
  SELECT DISTINCT ON (LEAST(c1.id, c2.id), GREATEST(c1.id, c2.id))
    c1.id, c2.id, 'name'::TEXT,
    similarity(
      COALESCE(c1.first_name, '') || ' ' || COALESCE(c1.last_name, ''),
      COALESCE(c2.first_name, '') || ' ' || COALESCE(c2.last_name, '')
    )::FLOAT
  FROM public.contacts c1
  JOIN public.contacts c2
    ON c1.id < c2.id
    AND c1.company_id = c2.company_id
  WHERE c1.company_id = p_company_id
    AND c1.is_deleted = false
    AND c2.is_deleted = false
    AND COALESCE(c1.first_name, '') != ''
    AND COALESCE(c2.first_name, '') != ''
    AND similarity(
      COALESCE(c1.first_name, '') || ' ' || COALESCE(c1.last_name, ''),
      COALESCE(c2.first_name, '') || ' ' || COALESCE(c2.last_name, '')
    ) > 0.6;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
