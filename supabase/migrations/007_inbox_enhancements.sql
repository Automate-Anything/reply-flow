-- ============================================================
-- Reply Flow — Inbox Enhancements Migration
-- Adds conversation assignment, status management, priority,
-- starring, snooze, conversation notes, and canned responses.
-- ============================================================

-- ============================================================
-- STEP 1: ALTER chat_sessions — new columns
-- ============================================================

-- 1a. Assigned-to (FK to users)
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_assigned
  ON public.chat_sessions(assigned_to) WHERE assigned_to IS NOT NULL;

-- 1b. Migrate status from 'active' to 'open'
UPDATE public.chat_sessions SET status = 'open' WHERE status = 'active';
UPDATE public.chat_sessions SET status = 'open'
  WHERE status NOT IN ('open', 'pending', 'resolved', 'closed');

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_status_check
  CHECK (status IN ('open', 'pending', 'resolved', 'closed'));

-- 1c. Priority field
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_priority_check
  CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_priority
  ON public.chat_sessions(priority) WHERE priority <> 'none';

-- 1d. Starred
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;

-- 1e. Snoozed until
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_snoozed
  ON public.chat_sessions(snoozed_until) WHERE snoozed_until IS NOT NULL;

-- ============================================================
-- STEP 2: conversation_notes table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.conversation_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_deleted  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversation_notes_session
  ON public.conversation_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_company
  ON public.conversation_notes(company_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS policies
CREATE POLICY "Company members can view conversation notes"
  ON public.conversation_notes FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create conversation notes"
  ON public.conversation_notes FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can update conversation notes"
  ON public.conversation_notes FOR UPDATE
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can delete conversation notes"
  ON public.conversation_notes FOR DELETE
  USING (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 3: canned_responses table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.canned_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  shortcut    TEXT,
  category    TEXT,
  created_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_deleted  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_canned_responses_company
  ON public.canned_responses(company_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_shortcut
  ON public.canned_responses(company_id, shortcut) WHERE shortcut IS NOT NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.canned_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS policies
CREATE POLICY "Company members can view canned responses"
  ON public.canned_responses FOR SELECT
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can create canned responses"
  ON public.canned_responses FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can update canned responses"
  ON public.canned_responses FOR UPDATE
  USING (company_id = public.get_user_company_id());

CREATE POLICY "Authorized users can delete canned responses"
  ON public.canned_responses FOR DELETE
  USING (company_id = public.get_user_company_id());

-- ============================================================
-- STEP 4: Add realtime for conversation_notes
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_notes;

-- ============================================================
-- STEP 5: Seed new permissions for existing companies
-- (Additive — does not touch existing permissions)
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
      -- conversation_notes permissions
      (comp.id, v_owner_id, 'conversation_notes', 'view'),
      (comp.id, v_owner_id, 'conversation_notes', 'create'),
      (comp.id, v_owner_id, 'conversation_notes', 'edit'),
      (comp.id, v_owner_id, 'conversation_notes', 'delete'),
      (comp.id, v_admin_id, 'conversation_notes', 'view'),
      (comp.id, v_admin_id, 'conversation_notes', 'create'),
      (comp.id, v_admin_id, 'conversation_notes', 'edit'),
      (comp.id, v_admin_id, 'conversation_notes', 'delete'),
      (comp.id, v_manager_id, 'conversation_notes', 'view'),
      (comp.id, v_manager_id, 'conversation_notes', 'create'),
      (comp.id, v_manager_id, 'conversation_notes', 'edit'),
      (comp.id, v_staff_id, 'conversation_notes', 'view'),
      (comp.id, v_staff_id, 'conversation_notes', 'create'),
      (comp.id, v_viewer_id, 'conversation_notes', 'view'),

      -- canned_responses permissions
      (comp.id, v_owner_id, 'canned_responses', 'view'),
      (comp.id, v_owner_id, 'canned_responses', 'create'),
      (comp.id, v_owner_id, 'canned_responses', 'edit'),
      (comp.id, v_owner_id, 'canned_responses', 'delete'),
      (comp.id, v_admin_id, 'canned_responses', 'view'),
      (comp.id, v_admin_id, 'canned_responses', 'create'),
      (comp.id, v_admin_id, 'canned_responses', 'edit'),
      (comp.id, v_admin_id, 'canned_responses', 'delete'),
      (comp.id, v_manager_id, 'canned_responses', 'view'),
      (comp.id, v_manager_id, 'canned_responses', 'create'),
      (comp.id, v_manager_id, 'canned_responses', 'edit'),
      (comp.id, v_staff_id, 'canned_responses', 'view'),
      (comp.id, v_viewer_id, 'canned_responses', 'view')
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
    (p_company_id, v_staff_id, 'conversation_notes', 'view'),
    (p_company_id, v_staff_id, 'conversation_notes', 'create'),
    (p_company_id, v_staff_id, 'canned_responses', 'view'),
    (p_company_id, v_staff_id, 'channels', 'view'),
    (p_company_id, v_staff_id, 'ai_settings', 'view'),
    (p_company_id, v_staff_id, 'knowledge_base', 'view'),
    (p_company_id, v_staff_id, 'labels', 'view'),
    (p_company_id, v_staff_id, 'workspaces', 'view'),

    -- Viewer: read-only
    (p_company_id, v_viewer_id, 'conversations', 'view'),
    (p_company_id, v_viewer_id, 'messages', 'view'),
    (p_company_id, v_viewer_id, 'contacts', 'view'),
    (p_company_id, v_viewer_id, 'conversation_notes', 'view'),
    (p_company_id, v_viewer_id, 'canned_responses', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view'),
    (p_company_id, v_viewer_id, 'workspaces', 'view')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
