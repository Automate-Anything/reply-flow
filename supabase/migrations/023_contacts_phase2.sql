-- ============================================================
-- MIGRATION 023: CONTACTS PHASE 2
-- Contact lists, advanced filtering indexes, bulk tag helpers.
-- ============================================================

-- ============================================================
-- STEP 1: contact_lists — company-level list definitions
-- ============================================================

CREATE TABLE public.contact_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  color        TEXT NOT NULL DEFAULT '#6B7280',
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_deleted   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contact_lists_company ON public.contact_lists(company_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "Company members can view contact lists"
  ON public.contact_lists FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create contact lists"
  ON public.contact_lists FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can update contact lists"
  ON public.contact_lists FOR UPDATE
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can delete contact lists"
  ON public.contact_lists FOR DELETE
  USING (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 2: contact_list_members — junction table
-- ============================================================

CREATE TABLE public.contact_list_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      UUID NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  added_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_id, contact_id)
);

ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contact_list_members_list ON public.contact_list_members(list_id);
CREATE INDEX idx_contact_list_members_contact ON public.contact_list_members(contact_id);

CREATE POLICY "Company members can view contact list members"
  ON public.contact_list_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.contact_lists cl
    WHERE cl.id = list_id AND cl.company_id = public.get_user_company_id()
  ));

CREATE POLICY "Authorized users can add contact list members"
  ON public.contact_list_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contact_lists cl
    WHERE cl.id = list_id AND cl.company_id = public.get_user_company_id()
  ));

CREATE POLICY "Authorized users can remove contact list members"
  ON public.contact_list_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.contact_lists cl
    WHERE cl.id = list_id AND cl.company_id = public.get_user_company_id()
  ));

-- ============================================================
-- STEP 3: Indexes for advanced filtering on contacts
-- ============================================================

CREATE INDEX idx_contacts_tags ON public.contacts USING GIN(tags) WHERE is_deleted = false;
CREATE INDEX idx_contacts_city ON public.contacts(address_city) WHERE is_deleted = false;
CREATE INDEX idx_contacts_country ON public.contacts(address_country) WHERE is_deleted = false;
CREATE INDEX idx_contacts_created_at ON public.contacts(created_at) WHERE is_deleted = false;

-- ============================================================
-- STEP 4: Helper functions for bulk tag operations
-- ============================================================

CREATE OR REPLACE FUNCTION public.bulk_add_tag(p_contact_ids UUID[], p_tag TEXT)
RETURNS VOID AS $$
  UPDATE public.contacts
  SET tags = array_append(tags, p_tag), updated_at = NOW()
  WHERE id = ANY(p_contact_ids) AND NOT (p_tag = ANY(tags));
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.bulk_remove_tag(p_contact_ids UUID[], p_tag TEXT)
RETURNS VOID AS $$
  UPDATE public.contacts
  SET tags = array_remove(tags, p_tag), updated_at = NOW()
  WHERE id = ANY(p_contact_ids) AND p_tag = ANY(tags);
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- STEP 5: Seed contact_lists permissions for existing companies
-- ============================================================

DO $$
DECLARE
  comp RECORD;
  v_owner_id UUID;
  v_admin_id UUID;
  v_manager_id UUID;
  v_staff_id UUID;
  v_viewer_id UUID;
BEGIN
  SELECT id INTO v_owner_id FROM public.roles WHERE name = 'owner';
  SELECT id INTO v_admin_id FROM public.roles WHERE name = 'admin';
  SELECT id INTO v_manager_id FROM public.roles WHERE name = 'manager';
  SELECT id INTO v_staff_id FROM public.roles WHERE name = 'staff';
  SELECT id INTO v_viewer_id FROM public.roles WHERE name = 'viewer';

  FOR comp IN SELECT id FROM public.companies LOOP
    INSERT INTO public.role_permissions (company_id, role_id, resource, action) VALUES
      (comp.id, v_owner_id, 'contact_lists', 'view'),
      (comp.id, v_owner_id, 'contact_lists', 'create'),
      (comp.id, v_owner_id, 'contact_lists', 'edit'),
      (comp.id, v_owner_id, 'contact_lists', 'delete'),
      (comp.id, v_admin_id, 'contact_lists', 'view'),
      (comp.id, v_admin_id, 'contact_lists', 'create'),
      (comp.id, v_admin_id, 'contact_lists', 'edit'),
      (comp.id, v_admin_id, 'contact_lists', 'delete'),
      (comp.id, v_manager_id, 'contact_lists', 'view'),
      (comp.id, v_manager_id, 'contact_lists', 'create'),
      (comp.id, v_manager_id, 'contact_lists', 'edit'),
      (comp.id, v_staff_id, 'contact_lists', 'view'),
      (comp.id, v_staff_id, 'contact_lists', 'create'),
      (comp.id, v_viewer_id, 'contact_lists', 'view')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- STEP 6: Update seed_default_permissions for future companies
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_company_id UUID)
RETURNS VOID AS $$
DECLARE
  v_owner_id UUID;
  v_admin_id UUID;
  v_manager_id UUID;
  v_staff_id UUID;
  v_viewer_id UUID;
BEGIN
  SELECT id INTO v_owner_id FROM public.roles WHERE name = 'owner';
  SELECT id INTO v_admin_id FROM public.roles WHERE name = 'admin';
  SELECT id INTO v_manager_id FROM public.roles WHERE name = 'manager';
  SELECT id INTO v_staff_id FROM public.roles WHERE name = 'staff';
  SELECT id INTO v_viewer_id FROM public.roles WHERE name = 'viewer';

  DELETE FROM public.role_permissions WHERE company_id = p_company_id;

  INSERT INTO public.role_permissions (company_id, role_id, resource, action) VALUES
    -- Owner: full access to everything
    (p_company_id, v_owner_id, 'conversations', 'view'),
    (p_company_id, v_owner_id, 'conversations', 'create'),
    (p_company_id, v_owner_id, 'conversations', 'edit'),
    (p_company_id, v_owner_id, 'conversations', 'delete'),
    (p_company_id, v_owner_id, 'messages', 'view'),
    (p_company_id, v_owner_id, 'messages', 'create'),
    (p_company_id, v_owner_id, 'contacts', 'view'),
    (p_company_id, v_owner_id, 'contacts', 'create'),
    (p_company_id, v_owner_id, 'contacts', 'edit'),
    (p_company_id, v_owner_id, 'contacts', 'delete'),
    (p_company_id, v_owner_id, 'contact_notes', 'view'),
    (p_company_id, v_owner_id, 'contact_notes', 'create'),
    (p_company_id, v_owner_id, 'contact_notes', 'edit'),
    (p_company_id, v_owner_id, 'contact_notes', 'delete'),
    (p_company_id, v_owner_id, 'contact_tags', 'view'),
    (p_company_id, v_owner_id, 'contact_tags', 'create'),
    (p_company_id, v_owner_id, 'contact_tags', 'edit'),
    (p_company_id, v_owner_id, 'contact_tags', 'delete'),
    (p_company_id, v_owner_id, 'contact_lists', 'view'),
    (p_company_id, v_owner_id, 'contact_lists', 'create'),
    (p_company_id, v_owner_id, 'contact_lists', 'edit'),
    (p_company_id, v_owner_id, 'contact_lists', 'delete'),
    (p_company_id, v_owner_id, 'conversation_notes', 'view'),
    (p_company_id, v_owner_id, 'conversation_notes', 'create'),
    (p_company_id, v_owner_id, 'conversation_notes', 'edit'),
    (p_company_id, v_owner_id, 'conversation_notes', 'delete'),
    (p_company_id, v_owner_id, 'canned_responses', 'view'),
    (p_company_id, v_owner_id, 'canned_responses', 'create'),
    (p_company_id, v_owner_id, 'canned_responses', 'edit'),
    (p_company_id, v_owner_id, 'canned_responses', 'delete'),
    (p_company_id, v_owner_id, 'channels', 'view'),
    (p_company_id, v_owner_id, 'channels', 'create'),
    (p_company_id, v_owner_id, 'channels', 'edit'),
    (p_company_id, v_owner_id, 'channels', 'delete'),
    (p_company_id, v_owner_id, 'ai_settings', 'view'),
    (p_company_id, v_owner_id, 'ai_settings', 'edit'),
    (p_company_id, v_owner_id, 'knowledge_base', 'view'),
    (p_company_id, v_owner_id, 'knowledge_base', 'create'),
    (p_company_id, v_owner_id, 'knowledge_base', 'edit'),
    (p_company_id, v_owner_id, 'knowledge_base', 'delete'),
    (p_company_id, v_owner_id, 'labels', 'view'),
    (p_company_id, v_owner_id, 'labels', 'create'),
    (p_company_id, v_owner_id, 'labels', 'edit'),
    (p_company_id, v_owner_id, 'labels', 'delete'),
    (p_company_id, v_owner_id, 'custom_fields', 'view'),
    (p_company_id, v_owner_id, 'custom_fields', 'create'),
    (p_company_id, v_owner_id, 'custom_fields', 'edit'),
    (p_company_id, v_owner_id, 'custom_fields', 'delete'),
    (p_company_id, v_owner_id, 'team', 'view'),
    (p_company_id, v_owner_id, 'team', 'invite'),
    (p_company_id, v_owner_id, 'team', 'edit'),
    (p_company_id, v_owner_id, 'team', 'remove'),
    (p_company_id, v_owner_id, 'company_settings', 'view'),
    (p_company_id, v_owner_id, 'company_settings', 'edit'),
    (p_company_id, v_owner_id, 'roles', 'view'),
    (p_company_id, v_owner_id, 'roles', 'edit'),
    (p_company_id, v_owner_id, 'workspaces', 'view'),
    (p_company_id, v_owner_id, 'workspaces', 'create'),
    (p_company_id, v_owner_id, 'workspaces', 'edit'),
    (p_company_id, v_owner_id, 'workspaces', 'delete'),

    -- Admin: same as owner
    (p_company_id, v_admin_id, 'conversations', 'view'),
    (p_company_id, v_admin_id, 'conversations', 'create'),
    (p_company_id, v_admin_id, 'conversations', 'edit'),
    (p_company_id, v_admin_id, 'conversations', 'delete'),
    (p_company_id, v_admin_id, 'messages', 'view'),
    (p_company_id, v_admin_id, 'messages', 'create'),
    (p_company_id, v_admin_id, 'contacts', 'view'),
    (p_company_id, v_admin_id, 'contacts', 'create'),
    (p_company_id, v_admin_id, 'contacts', 'edit'),
    (p_company_id, v_admin_id, 'contacts', 'delete'),
    (p_company_id, v_admin_id, 'contact_notes', 'view'),
    (p_company_id, v_admin_id, 'contact_notes', 'create'),
    (p_company_id, v_admin_id, 'contact_notes', 'edit'),
    (p_company_id, v_admin_id, 'contact_notes', 'delete'),
    (p_company_id, v_admin_id, 'contact_tags', 'view'),
    (p_company_id, v_admin_id, 'contact_tags', 'create'),
    (p_company_id, v_admin_id, 'contact_tags', 'edit'),
    (p_company_id, v_admin_id, 'contact_tags', 'delete'),
    (p_company_id, v_admin_id, 'contact_lists', 'view'),
    (p_company_id, v_admin_id, 'contact_lists', 'create'),
    (p_company_id, v_admin_id, 'contact_lists', 'edit'),
    (p_company_id, v_admin_id, 'contact_lists', 'delete'),
    (p_company_id, v_admin_id, 'conversation_notes', 'view'),
    (p_company_id, v_admin_id, 'conversation_notes', 'create'),
    (p_company_id, v_admin_id, 'conversation_notes', 'edit'),
    (p_company_id, v_admin_id, 'conversation_notes', 'delete'),
    (p_company_id, v_admin_id, 'canned_responses', 'view'),
    (p_company_id, v_admin_id, 'canned_responses', 'create'),
    (p_company_id, v_admin_id, 'canned_responses', 'edit'),
    (p_company_id, v_admin_id, 'canned_responses', 'delete'),
    (p_company_id, v_admin_id, 'channels', 'view'),
    (p_company_id, v_admin_id, 'channels', 'create'),
    (p_company_id, v_admin_id, 'channels', 'edit'),
    (p_company_id, v_admin_id, 'channels', 'delete'),
    (p_company_id, v_admin_id, 'ai_settings', 'view'),
    (p_company_id, v_admin_id, 'ai_settings', 'edit'),
    (p_company_id, v_admin_id, 'knowledge_base', 'view'),
    (p_company_id, v_admin_id, 'knowledge_base', 'create'),
    (p_company_id, v_admin_id, 'knowledge_base', 'edit'),
    (p_company_id, v_admin_id, 'knowledge_base', 'delete'),
    (p_company_id, v_admin_id, 'labels', 'view'),
    (p_company_id, v_admin_id, 'labels', 'create'),
    (p_company_id, v_admin_id, 'labels', 'edit'),
    (p_company_id, v_admin_id, 'labels', 'delete'),
    (p_company_id, v_admin_id, 'custom_fields', 'view'),
    (p_company_id, v_admin_id, 'custom_fields', 'create'),
    (p_company_id, v_admin_id, 'custom_fields', 'edit'),
    (p_company_id, v_admin_id, 'custom_fields', 'delete'),
    (p_company_id, v_admin_id, 'team', 'view'),
    (p_company_id, v_admin_id, 'team', 'invite'),
    (p_company_id, v_admin_id, 'team', 'edit'),
    (p_company_id, v_admin_id, 'team', 'remove'),
    (p_company_id, v_admin_id, 'company_settings', 'view'),
    (p_company_id, v_admin_id, 'company_settings', 'edit'),
    (p_company_id, v_admin_id, 'roles', 'view'),
    (p_company_id, v_admin_id, 'roles', 'edit'),
    (p_company_id, v_admin_id, 'workspaces', 'view'),
    (p_company_id, v_admin_id, 'workspaces', 'create'),
    (p_company_id, v_admin_id, 'workspaces', 'edit'),
    (p_company_id, v_admin_id, 'workspaces', 'delete'),

    -- Manager: most access
    (p_company_id, v_manager_id, 'conversations', 'view'),
    (p_company_id, v_manager_id, 'conversations', 'create'),
    (p_company_id, v_manager_id, 'conversations', 'edit'),
    (p_company_id, v_manager_id, 'messages', 'view'),
    (p_company_id, v_manager_id, 'messages', 'create'),
    (p_company_id, v_manager_id, 'contacts', 'view'),
    (p_company_id, v_manager_id, 'contacts', 'create'),
    (p_company_id, v_manager_id, 'contacts', 'edit'),
    (p_company_id, v_manager_id, 'contact_notes', 'view'),
    (p_company_id, v_manager_id, 'contact_notes', 'create'),
    (p_company_id, v_manager_id, 'contact_notes', 'edit'),
    (p_company_id, v_manager_id, 'contact_tags', 'view'),
    (p_company_id, v_manager_id, 'contact_tags', 'create'),
    (p_company_id, v_manager_id, 'contact_tags', 'edit'),
    (p_company_id, v_manager_id, 'contact_lists', 'view'),
    (p_company_id, v_manager_id, 'contact_lists', 'create'),
    (p_company_id, v_manager_id, 'contact_lists', 'edit'),
    (p_company_id, v_manager_id, 'conversation_notes', 'view'),
    (p_company_id, v_manager_id, 'conversation_notes', 'create'),
    (p_company_id, v_manager_id, 'conversation_notes', 'edit'),
    (p_company_id, v_manager_id, 'canned_responses', 'view'),
    (p_company_id, v_manager_id, 'canned_responses', 'create'),
    (p_company_id, v_manager_id, 'canned_responses', 'edit'),
    (p_company_id, v_manager_id, 'channels', 'view'),
    (p_company_id, v_manager_id, 'channels', 'create'),
    (p_company_id, v_manager_id, 'channels', 'edit'),
    (p_company_id, v_manager_id, 'ai_settings', 'view'),
    (p_company_id, v_manager_id, 'ai_settings', 'edit'),
    (p_company_id, v_manager_id, 'knowledge_base', 'view'),
    (p_company_id, v_manager_id, 'knowledge_base', 'create'),
    (p_company_id, v_manager_id, 'knowledge_base', 'edit'),
    (p_company_id, v_manager_id, 'labels', 'view'),
    (p_company_id, v_manager_id, 'labels', 'create'),
    (p_company_id, v_manager_id, 'labels', 'edit'),
    (p_company_id, v_manager_id, 'custom_fields', 'view'),
    (p_company_id, v_manager_id, 'team', 'view'),
    (p_company_id, v_manager_id, 'workspaces', 'view'),
    (p_company_id, v_manager_id, 'workspaces', 'create'),
    (p_company_id, v_manager_id, 'workspaces', 'edit'),
    (p_company_id, v_manager_id, 'workspaces', 'delete'),

    -- Staff: basic access
    (p_company_id, v_staff_id, 'conversations', 'view'),
    (p_company_id, v_staff_id, 'conversations', 'create'),
    (p_company_id, v_staff_id, 'conversations', 'edit'),
    (p_company_id, v_staff_id, 'messages', 'view'),
    (p_company_id, v_staff_id, 'messages', 'create'),
    (p_company_id, v_staff_id, 'contacts', 'view'),
    (p_company_id, v_staff_id, 'contacts', 'create'),
    (p_company_id, v_staff_id, 'contact_notes', 'view'),
    (p_company_id, v_staff_id, 'contact_notes', 'create'),
    (p_company_id, v_staff_id, 'contact_tags', 'view'),
    (p_company_id, v_staff_id, 'contact_tags', 'create'),
    (p_company_id, v_staff_id, 'contact_lists', 'view'),
    (p_company_id, v_staff_id, 'contact_lists', 'create'),
    (p_company_id, v_staff_id, 'conversation_notes', 'view'),
    (p_company_id, v_staff_id, 'conversation_notes', 'create'),
    (p_company_id, v_staff_id, 'canned_responses', 'view'),
    (p_company_id, v_staff_id, 'channels', 'view'),
    (p_company_id, v_staff_id, 'ai_settings', 'view'),
    (p_company_id, v_staff_id, 'knowledge_base', 'view'),
    (p_company_id, v_staff_id, 'labels', 'view'),
    (p_company_id, v_staff_id, 'custom_fields', 'view'),
    (p_company_id, v_staff_id, 'workspaces', 'view'),

    -- Viewer: read-only
    (p_company_id, v_viewer_id, 'conversations', 'view'),
    (p_company_id, v_viewer_id, 'messages', 'view'),
    (p_company_id, v_viewer_id, 'contacts', 'view'),
    (p_company_id, v_viewer_id, 'contact_notes', 'view'),
    (p_company_id, v_viewer_id, 'contact_tags', 'view'),
    (p_company_id, v_viewer_id, 'contact_lists', 'view'),
    (p_company_id, v_viewer_id, 'conversation_notes', 'view'),
    (p_company_id, v_viewer_id, 'canned_responses', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view'),
    (p_company_id, v_viewer_id, 'custom_fields', 'view'),
    (p_company_id, v_viewer_id, 'workspaces', 'view')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
