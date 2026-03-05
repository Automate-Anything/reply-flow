-- ============================================================
-- MIGRATION 021: CONTACTS PHASE 1
-- Tags definitions, address fields, custom fields system.
-- ============================================================

-- ============================================================
-- STEP 1: contact_tags — company-level tag definitions
-- ============================================================

CREATE TABLE public.contact_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6B7280',
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_deleted   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contact_tags_company ON public.contact_tags(company_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "Company members can view contact tags"
  ON public.contact_tags FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create contact tags"
  ON public.contact_tags FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can update contact tags"
  ON public.contact_tags FOR UPDATE
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can delete contact tags"
  ON public.contact_tags FOR DELETE
  USING (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 2: Address columns on contacts
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN address_street      TEXT,
  ADD COLUMN address_city        TEXT,
  ADD COLUMN address_state       TEXT,
  ADD COLUMN address_postal_code TEXT,
  ADD COLUMN address_country     TEXT;

-- ============================================================
-- STEP 3: custom_field_definitions — per-company field schema
-- ============================================================

CREATE TABLE public.custom_field_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  field_type     TEXT NOT NULL,
  options        JSONB DEFAULT '[]',
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_required    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name),
  CONSTRAINT valid_field_type CHECK (
    field_type IN ('short_text', 'long_text', 'number', 'dropdown', 'radio', 'multi_select')
  )
);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_custom_field_defs_company ON public.custom_field_definitions(company_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "Company members can view custom field definitions"
  ON public.custom_field_definitions FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create custom field definitions"
  ON public.custom_field_definitions FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can update custom field definitions"
  ON public.custom_field_definitions FOR UPDATE
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can delete custom field definitions"
  ON public.custom_field_definitions FOR DELETE
  USING (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 4: custom_field_values — stores actual data per contact
-- ============================================================

CREATE TABLE public.custom_field_values (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id           UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  field_definition_id  UUID NOT NULL REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE,
  value                TEXT,
  value_json           JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, field_definition_id)
);

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_custom_field_values_contact ON public.custom_field_values(contact_id);
CREATE INDEX idx_custom_field_values_definition ON public.custom_field_values(field_definition_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.custom_field_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "Company members can view custom field values"
  ON public.custom_field_values FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND c.company_id = public.get_user_company_id()
  ));

CREATE POLICY "Authorized users can create custom field values"
  ON public.custom_field_values FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND c.company_id = public.get_user_company_id()
  ));

CREATE POLICY "Authorized users can update custom field values"
  ON public.custom_field_values FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND c.company_id = public.get_user_company_id()
  ));

CREATE POLICY "Authorized users can delete custom field values"
  ON public.custom_field_values FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND c.company_id = public.get_user_company_id()
  ));

-- ============================================================
-- STEP 5: Helper function — rename tag across all contacts
-- ============================================================

CREATE OR REPLACE FUNCTION public.rename_contact_tag(
  p_company_id UUID, p_old_name TEXT, p_new_name TEXT
) RETURNS VOID AS $$
  UPDATE public.contacts
  SET tags = array_replace(tags, p_old_name, p_new_name),
      updated_at = NOW()
  WHERE company_id = p_company_id AND p_old_name = ANY(tags);
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- STEP 6: Seed new permissions for existing companies
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
      -- contact_tags permissions
      (comp.id, v_owner_id, 'contact_tags', 'view'),
      (comp.id, v_owner_id, 'contact_tags', 'create'),
      (comp.id, v_owner_id, 'contact_tags', 'edit'),
      (comp.id, v_owner_id, 'contact_tags', 'delete'),
      (comp.id, v_admin_id, 'contact_tags', 'view'),
      (comp.id, v_admin_id, 'contact_tags', 'create'),
      (comp.id, v_admin_id, 'contact_tags', 'edit'),
      (comp.id, v_admin_id, 'contact_tags', 'delete'),
      (comp.id, v_manager_id, 'contact_tags', 'view'),
      (comp.id, v_manager_id, 'contact_tags', 'create'),
      (comp.id, v_manager_id, 'contact_tags', 'edit'),
      (comp.id, v_staff_id, 'contact_tags', 'view'),
      (comp.id, v_staff_id, 'contact_tags', 'create'),
      (comp.id, v_viewer_id, 'contact_tags', 'view'),

      -- custom_fields permissions
      (comp.id, v_owner_id, 'custom_fields', 'view'),
      (comp.id, v_owner_id, 'custom_fields', 'create'),
      (comp.id, v_owner_id, 'custom_fields', 'edit'),
      (comp.id, v_owner_id, 'custom_fields', 'delete'),
      (comp.id, v_admin_id, 'custom_fields', 'view'),
      (comp.id, v_admin_id, 'custom_fields', 'create'),
      (comp.id, v_admin_id, 'custom_fields', 'edit'),
      (comp.id, v_admin_id, 'custom_fields', 'delete'),
      (comp.id, v_manager_id, 'custom_fields', 'view'),
      (comp.id, v_staff_id, 'custom_fields', 'view'),
      (comp.id, v_viewer_id, 'custom_fields', 'view')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- STEP 7: Update seed_default_permissions for future companies
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
    (p_company_id, v_viewer_id, 'conversation_notes', 'view'),
    (p_company_id, v_viewer_id, 'canned_responses', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view'),
    (p_company_id, v_viewer_id, 'custom_fields', 'view'),
    (p_company_id, v_viewer_id, 'workspaces', 'view')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
