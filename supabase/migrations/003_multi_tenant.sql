-- ============================================================
-- Reply Flow — Multi-Tenant Migration
-- Migrates from single-user ownership to company/user/role model
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ============================================================
-- STEP 1: RENAME profiles → users
-- ============================================================

-- Drop existing triggers on profiles
DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;

-- Drop existing RLS policies on profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Rename the table
ALTER TABLE public.profiles RENAME TO users;

-- Re-create updated_at trigger on renamed table
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Update the signup trigger to use new table name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STEP 2: CREATE NEW TABLES
-- ============================================================

-- 2a. Companies
CREATE TABLE public.companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2b. Roles (global lookup table)
CREATE TABLE public.roles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT UNIQUE NOT NULL,
  description      TEXT,
  hierarchy_level  INTEGER NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read roles
CREATE POLICY "Authenticated users can read roles"
  ON public.roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seed the 5 roles
INSERT INTO public.roles (name, description, hierarchy_level) VALUES
  ('owner', 'Full access, can manage all team members and company settings', 100),
  ('admin', 'Full data access, can manage team (except removing members)', 80),
  ('manager', 'Can manage contacts, labels, KB, and view AI settings', 60),
  ('staff', 'Can view and create basic data, send messages', 40),
  ('viewer', 'Read-only access to conversations, contacts, and messages', 20);

-- 2c. Company Members (links users to companies with roles)
CREATE TABLE public.company_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  invited_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id),
  UNIQUE(user_id)  -- enforces one company per user
);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_company_members_user ON public.company_members(user_id);
CREATE INDEX idx_company_members_company ON public.company_members(company_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2d. Role Permissions (per-company, customizable)
CREATE TABLE public.role_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  UNIQUE(company_id, role_id, resource, action)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_role_permissions_company ON public.role_permissions(company_id);
CREATE INDEX idx_role_permissions_lookup ON public.role_permissions(company_id, role_id);

-- 2e. Invitations
CREATE TABLE public.invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role_id     UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, email)
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 3: ADD company_id AND created_by TO EXISTING TABLES
-- ============================================================

-- Add company_id (nullable initially for migration)
ALTER TABLE public.users ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_channels ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_channels ADD COLUMN created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.chat_sessions ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.chat_messages ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.contacts ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.contacts ADD COLUMN created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.contact_notes ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.contact_notes ADD COLUMN created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.labels ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.labels ADD COLUMN created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 3b: CREATE channel_ai_profiles & knowledge_base_entries
-- (These tables were never applied to the DB, so we create them fresh with company_id)
-- ============================================================

CREATE TABLE public.channel_ai_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_enabled    BOOLEAN DEFAULT FALSE,
  profile_data  JSONB DEFAULT '{}',
  max_tokens    INTEGER DEFAULT 500,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id)
);

ALTER TABLE public.channel_ai_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.channel_ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_channel_ai_profiles_company ON public.channel_ai_profiles(company_id);

CREATE TABLE public.knowledge_base_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source_type   TEXT DEFAULT 'text',
  file_name     TEXT,
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.knowledge_base_entries ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_kb_entries_channel ON public.knowledge_base_entries(channel_id);
CREATE INDEX idx_kb_entries_company ON public.knowledge_base_entries(company_id);

-- Storage bucket for knowledge base file uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 4: MIGRATE EXISTING DATA
-- ============================================================

-- 4a. Create a company for each existing user
INSERT INTO public.companies (id, name)
SELECT
  gen_random_uuid(),
  COALESCE(NULLIF(u.full_name, '') || '''s Company', u.email || '''s Company', 'My Company')
FROM public.users u;

-- We need a way to link companies back to users. Use a temp table.
CREATE TEMP TABLE user_company_map AS
SELECT
  u.id AS user_id,
  c.id AS company_id
FROM public.users u
JOIN public.companies c
  ON c.name = COALESCE(NULLIF(u.full_name, '') || '''s Company', u.email || '''s Company', 'My Company');

-- 4b. Create company_members (user = owner)
INSERT INTO public.company_members (company_id, user_id, role_id)
SELECT
  ucm.company_id,
  ucm.user_id,
  (SELECT id FROM public.roles WHERE name = 'owner')
FROM user_company_map ucm;

-- 4c. Set company_id on users
UPDATE public.users u
SET company_id = ucm.company_id
FROM user_company_map ucm
WHERE u.id = ucm.user_id;

-- 4d. Backfill company_id on all data tables
UPDATE public.whatsapp_channels t
SET company_id = ucm.company_id, created_by = t.user_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

UPDATE public.chat_sessions t
SET company_id = ucm.company_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

UPDATE public.chat_messages t
SET company_id = ucm.company_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

UPDATE public.contacts t
SET company_id = ucm.company_id, created_by = t.user_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

UPDATE public.contact_notes t
SET company_id = ucm.company_id, created_by = t.user_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

UPDATE public.labels t
SET company_id = ucm.company_id, created_by = t.user_id
FROM user_company_map ucm
WHERE t.user_id = ucm.user_id AND t.company_id IS NULL;

-- channel_ai_profiles and knowledge_base_entries are created fresh with company_id — no backfill needed.

-- Clean up temp table
DROP TABLE user_company_map;

-- 4e. Make company_id NOT NULL on data tables (not on users — it can be null briefly during signup)
ALTER TABLE public.whatsapp_channels ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.chat_sessions ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.chat_messages ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.contact_notes ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.labels ALTER COLUMN company_id SET NOT NULL;

-- ============================================================
-- STEP 5: ADD INDEXES ON company_id
-- ============================================================

CREATE INDEX idx_users_company ON public.users(company_id);
CREATE INDEX idx_whatsapp_channels_company ON public.whatsapp_channels(company_id);
CREATE INDEX idx_chat_sessions_company ON public.chat_sessions(company_id);
CREATE INDEX idx_chat_messages_company ON public.chat_messages(company_id);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);
CREATE INDEX idx_contact_notes_company ON public.contact_notes(company_id);
CREATE INDEX idx_labels_company ON public.labels(company_id);
-- idx_channel_ai_profiles_company and idx_kb_entries_company created in STEP 3b

-- ============================================================
-- STEP 6: UPDATE UNIQUE CONSTRAINTS
-- ============================================================

-- Contacts: unique phone per company (not per user)
ALTER TABLE public.contacts DROP CONSTRAINT contacts_user_id_phone_number_key;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_company_id_phone_number_key UNIQUE(company_id, phone_number);

-- Labels: unique name per company (not per user)
ALTER TABLE public.labels DROP CONSTRAINT labels_user_id_name_key;
ALTER TABLE public.labels ADD CONSTRAINT labels_company_id_name_key UNIQUE(company_id, name);

-- ============================================================
-- STEP 7: SEED DEFAULT PERMISSIONS FUNCTION + SEED FOR EXISTING COMPANIES
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
    (p_company_id, v_owner_id, 'team', 'edit_role'),
    (p_company_id, v_owner_id, 'team', 'remove'),
    (p_company_id, v_owner_id, 'company_settings', 'view'),
    (p_company_id, v_owner_id, 'company_settings', 'edit'),
    (p_company_id, v_owner_id, 'role_permissions', 'view'),
    (p_company_id, v_owner_id, 'role_permissions', 'edit'),

    -- Admin: same as owner except team.remove
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
    (p_company_id, v_admin_id, 'team', 'edit_role'),
    (p_company_id, v_admin_id, 'company_settings', 'view'),
    (p_company_id, v_admin_id, 'company_settings', 'edit'),
    (p_company_id, v_admin_id, 'role_permissions', 'view'),
    (p_company_id, v_admin_id, 'role_permissions', 'edit'),

    -- Manager: mid-tier
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
    (p_company_id, v_manager_id, 'ai_settings', 'view'),
    (p_company_id, v_manager_id, 'knowledge_base', 'view'),
    (p_company_id, v_manager_id, 'knowledge_base', 'create'),
    (p_company_id, v_manager_id, 'knowledge_base', 'edit'),
    (p_company_id, v_manager_id, 'labels', 'view'),
    (p_company_id, v_manager_id, 'labels', 'create'),
    (p_company_id, v_manager_id, 'labels', 'edit'),

    -- Staff: basic create access
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
    (p_company_id, v_staff_id, 'labels', 'view'),

    -- Viewer: read-only
    (p_company_id, v_viewer_id, 'conversations', 'view'),
    (p_company_id, v_viewer_id, 'messages', 'view'),
    (p_company_id, v_viewer_id, 'contacts', 'view'),
    (p_company_id, v_viewer_id, 'contact_notes', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed default permissions for all existing companies
DO $$
DECLARE
  comp RECORD;
BEGIN
  FOR comp IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_default_permissions(comp.id);
  END LOOP;
END;
$$;

-- ============================================================
-- STEP 8: RLS HELPER FUNCTIONS
-- ============================================================

-- Get the company_id for the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.company_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get the role_id for the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_role_id()
RETURNS UUID AS $$
  SELECT role_id FROM public.company_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get the role name for the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_role_name()
RETURNS TEXT AS $$
  SELECT r.name FROM public.company_members cm
  JOIN public.roles r ON r.id = cm.role_id
  WHERE cm.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if the current user has a specific permission
-- Owner role ALWAYS returns true (immutable full access)
CREATE OR REPLACE FUNCTION public.has_permission(p_resource TEXT, p_action TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_role_name TEXT;
  v_company_id UUID;
  v_role_id UUID;
BEGIN
  -- Get user's role and company
  SELECT r.name, cm.company_id, cm.role_id
  INTO v_role_name, v_company_id, v_role_id
  FROM public.company_members cm
  JOIN public.roles r ON r.id = cm.role_id
  WHERE cm.user_id = auth.uid()
  LIMIT 1;

  -- Owner always has full access (cannot be reduced)
  IF v_role_name = 'owner' THEN
    RETURN TRUE;
  END IF;

  -- Check role_permissions for the user's company
  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.company_id = v_company_id
      AND rp.role_id = v_role_id
      AND rp.resource = p_resource
      AND rp.action = p_action
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Check if the current user is a member of a specific company
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- STEP 9: DROP ALL OLD RLS POLICIES & CREATE NEW ONES
-- ============================================================

-- ---- Users (formerly profiles) ----
CREATE POLICY "Users can read own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Company members can read team profiles"
  ON public.users FOR SELECT
  USING (
    company_id IS NOT NULL
    AND company_id = public.get_user_company_id()
  );

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- ---- Companies ----
CREATE POLICY "Members can view own company"
  ON public.companies FOR SELECT
  USING (public.is_company_member(id));

CREATE POLICY "Authorized users can update company"
  ON public.companies FOR UPDATE
  USING (
    public.is_company_member(id)
    AND public.has_permission('company_settings', 'edit')
  );

-- ---- Company Members ----
CREATE POLICY "Members can view team"
  ON public.company_members FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can insert members"
  ON public.company_members FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'invite')
  );

CREATE POLICY "Authorized users can update members"
  ON public.company_members FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'edit_role')
  );

CREATE POLICY "Authorized users can remove members"
  ON public.company_members FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'remove')
  );

-- ---- Role Permissions ----
CREATE POLICY "Company members can read own permissions"
  ON public.role_permissions FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can manage permissions"
  ON public.role_permissions FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('role_permissions', 'edit')
  );

CREATE POLICY "Authorized users can update permissions"
  ON public.role_permissions FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('role_permissions', 'edit')
  );

CREATE POLICY "Authorized users can delete permissions"
  ON public.role_permissions FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('role_permissions', 'edit')
  );

-- ---- Invitations ----
CREATE POLICY "Team members can view invitations"
  ON public.invitations FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'view')
  );

CREATE POLICY "Invited users can view own invitations"
  ON public.invitations FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Authorized users can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'invite')
  );

CREATE POLICY "Authorized users can delete invitations"
  ON public.invitations FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('team', 'invite')
  );

-- ---- WhatsApp Channels ----
DROP POLICY IF EXISTS "Users can read own channels" ON public.whatsapp_channels;
DROP POLICY IF EXISTS "Users can insert own channels" ON public.whatsapp_channels;
DROP POLICY IF EXISTS "Users can update own channels" ON public.whatsapp_channels;
DROP POLICY IF EXISTS "Users can delete own channels" ON public.whatsapp_channels;

CREATE POLICY "Company members can view channels"
  ON public.whatsapp_channels FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'view')
  );

CREATE POLICY "Authorized users can create channels"
  ON public.whatsapp_channels FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'create')
  );

CREATE POLICY "Authorized users can update channels"
  ON public.whatsapp_channels FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'edit')
  );

CREATE POLICY "Authorized users can delete channels"
  ON public.whatsapp_channels FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'delete')
  );

-- ---- Chat Sessions ----
DROP POLICY IF EXISTS "Users can read own sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.chat_sessions;

CREATE POLICY "Company members can view sessions"
  ON public.chat_sessions FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversations', 'view')
  );

CREATE POLICY "Authorized users can create sessions"
  ON public.chat_sessions FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversations', 'create')
  );

CREATE POLICY "Authorized users can update sessions"
  ON public.chat_sessions FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversations', 'edit')
  );

CREATE POLICY "Authorized users can delete sessions"
  ON public.chat_sessions FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversations', 'delete')
  );

-- ---- Chat Messages ----
DROP POLICY IF EXISTS "Users can read own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.chat_messages;

CREATE POLICY "Company members can view messages"
  ON public.chat_messages FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('messages', 'view')
  );

CREATE POLICY "Authorized users can create messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('messages', 'create')
  );

CREATE POLICY "Authorized users can update messages"
  ON public.chat_messages FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('messages', 'view')
  );

-- ---- Contacts ----
DROP POLICY IF EXISTS "Users can read own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can insert own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can update own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can delete own contacts" ON public.contacts;

CREATE POLICY "Company members can view contacts"
  ON public.contacts FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contacts', 'view')
  );

CREATE POLICY "Authorized users can create contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('contacts', 'create')
  );

CREATE POLICY "Authorized users can update contacts"
  ON public.contacts FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contacts', 'edit')
  );

CREATE POLICY "Authorized users can delete contacts"
  ON public.contacts FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contacts', 'delete')
  );

-- ---- Contact Notes ----
DROP POLICY IF EXISTS "Users can read own notes" ON public.contact_notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON public.contact_notes;
DROP POLICY IF EXISTS "Users can update own notes" ON public.contact_notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON public.contact_notes;

CREATE POLICY "Company members can view notes"
  ON public.contact_notes FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contact_notes', 'view')
  );

CREATE POLICY "Authorized users can create notes"
  ON public.contact_notes FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('contact_notes', 'create')
  );

CREATE POLICY "Authorized users can update notes"
  ON public.contact_notes FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contact_notes', 'edit')
  );

CREATE POLICY "Authorized users can delete notes"
  ON public.contact_notes FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('contact_notes', 'delete')
  );

-- ---- Labels ----
DROP POLICY IF EXISTS "Users can read own labels" ON public.labels;
DROP POLICY IF EXISTS "Users can insert own labels" ON public.labels;
DROP POLICY IF EXISTS "Users can update own labels" ON public.labels;
DROP POLICY IF EXISTS "Users can delete own labels" ON public.labels;

CREATE POLICY "Company members can view labels"
  ON public.labels FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('labels', 'view')
  );

CREATE POLICY "Authorized users can create labels"
  ON public.labels FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('labels', 'create')
  );

CREATE POLICY "Authorized users can update labels"
  ON public.labels FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('labels', 'edit')
  );

CREATE POLICY "Authorized users can delete labels"
  ON public.labels FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('labels', 'delete')
  );

-- ---- Conversation Labels (join table) ----
DROP POLICY IF EXISTS "Users can read own conversation labels" ON public.conversation_labels;
DROP POLICY IF EXISTS "Users can insert own conversation labels" ON public.conversation_labels;
DROP POLICY IF EXISTS "Users can delete own conversation labels" ON public.conversation_labels;

CREATE POLICY "Company members can view conversation labels"
  ON public.conversation_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = conversation_labels.session_id
        AND cs.company_id = public.get_user_company_id()
    )
  );

CREATE POLICY "Authorized users can assign labels"
  ON public.conversation_labels FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = conversation_labels.session_id
        AND cs.company_id = public.get_user_company_id()
    )
    AND public.has_permission('labels', 'create')
  );

CREATE POLICY "Authorized users can remove labels"
  ON public.conversation_labels FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = conversation_labels.session_id
        AND cs.company_id = public.get_user_company_id()
    )
    AND public.has_permission('labels', 'delete')
  );

-- ---- AI Settings (legacy) ----
DROP POLICY IF EXISTS "Users can read own ai settings" ON public.ai_settings;
DROP POLICY IF EXISTS "Users can insert own ai settings" ON public.ai_settings;
DROP POLICY IF EXISTS "Users can update own ai settings" ON public.ai_settings;

CREATE POLICY "Users can read own ai settings"
  ON public.ai_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own ai settings"
  ON public.ai_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- ---- Channel AI Profiles ----
DROP POLICY IF EXISTS "Users can read own ai profiles" ON public.channel_ai_profiles;
DROP POLICY IF EXISTS "Users can insert own ai profiles" ON public.channel_ai_profiles;
DROP POLICY IF EXISTS "Users can update own ai profiles" ON public.channel_ai_profiles;
DROP POLICY IF EXISTS "Users can delete own ai profiles" ON public.channel_ai_profiles;

CREATE POLICY "Company members can view ai profiles"
  ON public.channel_ai_profiles FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'view')
  );

CREATE POLICY "Authorized users can create ai profiles"
  ON public.channel_ai_profiles FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can update ai profiles"
  ON public.channel_ai_profiles FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

CREATE POLICY "Authorized users can delete ai profiles"
  ON public.channel_ai_profiles FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('ai_settings', 'edit')
  );

-- ---- Knowledge Base Entries ----
DROP POLICY IF EXISTS "Users can read own kb entries" ON public.knowledge_base_entries;
DROP POLICY IF EXISTS "Users can insert own kb entries" ON public.knowledge_base_entries;
DROP POLICY IF EXISTS "Users can update own kb entries" ON public.knowledge_base_entries;
DROP POLICY IF EXISTS "Users can delete own kb entries" ON public.knowledge_base_entries;

CREATE POLICY "Company members can view kb entries"
  ON public.knowledge_base_entries FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'view')
  );

CREATE POLICY "Authorized users can create kb entries"
  ON public.knowledge_base_entries FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'create')
  );

CREATE POLICY "Authorized users can update kb entries"
  ON public.knowledge_base_entries FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'edit')
  );

CREATE POLICY "Authorized users can delete kb entries"
  ON public.knowledge_base_entries FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'delete')
  );

-- ---- Storage Policies ----
DROP POLICY IF EXISTS "Users can upload kb files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own kb files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own kb files" ON storage.objects;

CREATE POLICY "Company members can upload kb files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'knowledge-base'
    AND public.get_user_company_id()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Company members can read kb files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'knowledge-base'
    AND public.get_user_company_id()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Company members can delete kb files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'knowledge-base'
    AND public.get_user_company_id()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- STEP 10: UPDATE SIGNUP TRIGGER (auto-create company)
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_company_id UUID;
  owner_role_id UUID;
  user_name TEXT;
  has_invitation BOOLEAN;
BEGIN
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    ''
  );

  -- 1. Create user record
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    user_name,
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );

  -- 2. Check for pending invitations
  SELECT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = NEW.email
      AND accepted_at IS NULL
      AND expires_at > NOW()
  ) INTO has_invitation;

  -- 3. If no invitation, auto-create a company
  IF NOT has_invitation THEN
    -- Get the owner role id
    SELECT id INTO owner_role_id FROM public.roles WHERE name = 'owner';

    -- Create company
    new_company_id := gen_random_uuid();
    INSERT INTO public.companies (id, name)
    VALUES (new_company_id, COALESCE(NULLIF(user_name, '') || '''s Company', NEW.email || '''s Company'));

    -- Make them the owner
    INSERT INTO public.company_members (company_id, user_id, role_id)
    VALUES (new_company_id, NEW.id, owner_role_id);

    -- Set company_id on user
    UPDATE public.users SET company_id = new_company_id WHERE id = NEW.id;

    -- Seed default permissions
    PERFORM public.seed_default_permissions(new_company_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
