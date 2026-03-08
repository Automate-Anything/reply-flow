-- Migration 030: Contact Lists
-- Allows grouping contacts into named lists (e.g., "VIP Customers", "Newsletter").

-- 1. Create contact_lists table
CREATE TABLE IF NOT EXISTS public.contact_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unique name per company (only among non-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_lists_name
  ON public.contact_lists(company_id, name) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_contact_lists_company
  ON public.contact_lists(company_id) WHERE is_deleted = false;

-- 2. Create contact_list_members junction table
CREATE TABLE IF NOT EXISTS public.contact_list_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     UUID NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  added_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_list_members_unique
  ON public.contact_list_members(list_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_contact
  ON public.contact_list_members(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_list
  ON public.contact_list_members(list_id);

-- 3. Enable RLS
ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_lists_company_access" ON public.contact_lists
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "contact_list_members_access" ON public.contact_list_members
  FOR ALL USING (
    list_id IN (
      SELECT id FROM public.contact_lists WHERE company_id IN (
        SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
      )
    )
  );
