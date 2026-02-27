-- ============================================================
-- MIGRATION 004: WORKSPACES
-- Introduces workspace layer: Company → Workspaces → Channels
-- AI profiles move from per-channel to per-workspace.
-- KB entries move from per-channel to per-workspace.
-- Per-channel agent settings + KB assignments added.
-- ============================================================

-- ============================================================
-- STEP 1: CREATE WORKSPACES TABLE
-- ============================================================
CREATE TABLE public.workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, name)
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_workspaces_company ON public.workspaces(company_id);

-- ============================================================
-- STEP 2: CREATE WORKSPACE_AI_PROFILES TABLE
-- (replaces channel_ai_profiles)
-- ============================================================
CREATE TABLE public.workspace_ai_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_enabled    BOOLEAN DEFAULT FALSE,
  profile_data  JSONB DEFAULT '{}',
  max_tokens    INTEGER DEFAULT 500,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)
);

ALTER TABLE public.workspace_ai_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_workspace_ai_profiles_company ON public.workspace_ai_profiles(company_id);

-- ============================================================
-- STEP 3: CREATE CHANNEL_AGENT_SETTINGS TABLE
-- (per-channel AI toggle + overrides)
-- ============================================================
CREATE TABLE public.channel_agent_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_enabled          BOOLEAN DEFAULT TRUE,
  custom_instructions TEXT,
  greeting_override   TEXT,
  max_tokens_override INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id)
);

ALTER TABLE public.channel_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.channel_agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_channel_agent_settings_company ON public.channel_agent_settings(company_id);

-- ============================================================
-- STEP 4: ADD workspace_id TO whatsapp_channels
-- ============================================================
ALTER TABLE public.whatsapp_channels
  ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX idx_whatsapp_channels_workspace ON public.whatsapp_channels(workspace_id);

-- ============================================================
-- STEP 5: MIGRATE knowledge_base_entries FROM channel TO workspace
-- ============================================================
ALTER TABLE public.knowledge_base_entries
  ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Make channel_id nullable (no longer primary FK)
ALTER TABLE public.knowledge_base_entries
  ALTER COLUMN channel_id DROP NOT NULL;

CREATE INDEX idx_kb_entries_workspace ON public.knowledge_base_entries(workspace_id);

-- ============================================================
-- STEP 6: CREATE CHANNEL_KB_ASSIGNMENTS TABLE
-- (many-to-many: which KB entries are active for which channels)
-- ============================================================
CREATE TABLE public.channel_kb_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  entry_id    UUID NOT NULL REFERENCES public.knowledge_base_entries(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, entry_id)
);

ALTER TABLE public.channel_kb_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_channel_kb_assignments_channel ON public.channel_kb_assignments(channel_id);
CREATE INDEX idx_channel_kb_assignments_entry ON public.channel_kb_assignments(entry_id);

-- ============================================================
-- STEP 7: DROP channel_ai_profiles (replaced by workspace_ai_profiles + channel_agent_settings)
-- ============================================================
DROP TABLE IF EXISTS public.channel_ai_profiles CASCADE;

-- ============================================================
-- STEP 8: RLS POLICIES
-- ============================================================

-- ---- Workspaces ----
CREATE POLICY "Company members can view workspaces"
  ON public.workspaces FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('workspaces', 'view')
  );

CREATE POLICY "Authorized users can create workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('workspaces', 'create')
  );

CREATE POLICY "Authorized users can update workspaces"
  ON public.workspaces FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('workspaces', 'edit')
  );

CREATE POLICY "Authorized users can delete workspaces"
  ON public.workspaces FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('workspaces', 'delete')
  );

-- ---- Workspace AI Profiles ----
CREATE POLICY "Company members can view workspace ai profiles"
  ON public.workspace_ai_profiles FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'view')
  );

CREATE POLICY "Authorized users can create workspace ai profiles"
  ON public.workspace_ai_profiles FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can update workspace ai profiles"
  ON public.workspace_ai_profiles FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can delete workspace ai profiles"
  ON public.workspace_ai_profiles FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

-- ---- Channel Agent Settings ----
CREATE POLICY "Company members can view channel agent settings"
  ON public.channel_agent_settings FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'view')
  );

CREATE POLICY "Authorized users can create channel agent settings"
  ON public.channel_agent_settings FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can update channel agent settings"
  ON public.channel_agent_settings FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can delete channel agent settings"
  ON public.channel_agent_settings FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

-- ---- Channel KB Assignments ----
CREATE POLICY "Company members can view channel kb assignments"
  ON public.channel_kb_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_kb_assignments.channel_id
        AND wc.company_id = public.get_user_company_id()
    )
    AND public.has_permission('knowledge_base', 'view')
  );

CREATE POLICY "Authorized users can create channel kb assignments"
  ON public.channel_kb_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_kb_assignments.channel_id
        AND wc.company_id = public.get_user_company_id()
    )
    AND public.has_permission('knowledge_base', 'edit')
  );

CREATE POLICY "Authorized users can delete channel kb assignments"
  ON public.channel_kb_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_kb_assignments.channel_id
        AND wc.company_id = public.get_user_company_id()
    )
    AND public.has_permission('knowledge_base', 'edit')
  );

-- ============================================================
-- STEP 9: ADD WORKSPACE PERMISSIONS TO SEED FUNCTION
-- ============================================================

-- Add workspace permissions for existing companies
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
    INSERT INTO public.role_permissions (company_id, role_id, resource, action)
    VALUES
      -- owner, admin, manager: full workspace access
      (comp.id, v_owner_id, 'workspaces', 'view'),
      (comp.id, v_owner_id, 'workspaces', 'create'),
      (comp.id, v_owner_id, 'workspaces', 'edit'),
      (comp.id, v_owner_id, 'workspaces', 'delete'),
      (comp.id, v_admin_id, 'workspaces', 'view'),
      (comp.id, v_admin_id, 'workspaces', 'create'),
      (comp.id, v_admin_id, 'workspaces', 'edit'),
      (comp.id, v_admin_id, 'workspaces', 'delete'),
      (comp.id, v_manager_id, 'workspaces', 'view'),
      (comp.id, v_manager_id, 'workspaces', 'create'),
      (comp.id, v_manager_id, 'workspaces', 'edit'),
      (comp.id, v_manager_id, 'workspaces', 'delete'),
      -- staff + viewer: view only
      (comp.id, v_staff_id, 'workspaces', 'view'),
      (comp.id, v_viewer_id, 'workspaces', 'view')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Update the seed function for future companies (matches original pattern from 003)
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

  -- Delete existing permissions for this company (for reset)
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

    -- Manager: most access, no delete conversations, no team manage, no company settings
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
    (p_company_id, v_staff_id, 'channels', 'view'),
    (p_company_id, v_staff_id, 'ai_settings', 'view'),
    (p_company_id, v_staff_id, 'knowledge_base', 'view'),
    (p_company_id, v_staff_id, 'labels', 'view'),
    (p_company_id, v_staff_id, 'workspaces', 'view'),

    -- Viewer: read-only
    (p_company_id, v_viewer_id, 'conversations', 'view'),
    (p_company_id, v_viewer_id, 'messages', 'view'),
    (p_company_id, v_viewer_id, 'contacts', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view'),
    (p_company_id, v_viewer_id, 'workspaces', 'view')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
