-- ============================================================
-- Migration 036: Fix Role Permissions & RLS Policy Gaps
--
-- Problems fixed:
-- 1. conversation_statuses resource missing from seed + existing companies
-- 2. ai_settings missing create/delete actions (agents can't be created by non-owners)
-- 3. billing has no permission resource (any member can manage billing)
-- 4. roles.* mismatch → should be role_permissions.*
-- 5. team.edit mismatch → should be team.edit_role
-- 6. Stale workspaces.* permissions (feature removed in migration 009)
-- 7. conversation_statuses RLS too permissive (single FOR ALL policy)
-- ============================================================

-- ============================================================
-- STEP 1: Fix mismatched resource names for existing companies
-- ============================================================

-- Fix roles.* → role_permissions.*
UPDATE public.role_permissions SET resource = 'role_permissions' WHERE resource = 'roles';

-- Fix team.edit → team.edit_role
UPDATE public.role_permissions SET action = 'edit_role' WHERE resource = 'team' AND action = 'edit';

-- Remove stale workspaces permissions
DELETE FROM public.role_permissions WHERE resource = 'workspaces';

-- ============================================================
-- STEP 2: Add missing permissions for existing companies
-- ============================================================

-- Add conversation_statuses permissions
INSERT INTO public.role_permissions (company_id, role_id, resource, action)
SELECT cm.company_id, r.id, rs.resource, rs.action
FROM (
  SELECT DISTINCT company_id FROM public.company_members
) cm
CROSS JOIN public.roles r
CROSS JOIN (
  VALUES
    ('conversation_statuses', 'view'),
    ('conversation_statuses', 'create'),
    ('conversation_statuses', 'edit'),
    ('conversation_statuses', 'delete')
) AS rs(resource, action)
WHERE (
  (r.name IN ('owner', 'admin', 'manager') AND rs.action IN ('view', 'create', 'edit', 'delete'))
  OR (r.name IN ('staff', 'viewer') AND rs.action = 'view')
)
ON CONFLICT DO NOTHING;

-- Add ai_settings.create and ai_settings.delete
INSERT INTO public.role_permissions (company_id, role_id, resource, action)
SELECT cm.company_id, r.id, 'ai_settings', rs.action
FROM (
  SELECT DISTINCT company_id FROM public.company_members
) cm
CROSS JOIN public.roles r
CROSS JOIN (
  VALUES ('create'), ('delete')
) AS rs(action)
WHERE r.name IN ('owner', 'admin')
ON CONFLICT DO NOTHING;

-- Add billing permissions
INSERT INTO public.role_permissions (company_id, role_id, resource, action)
SELECT cm.company_id, r.id, 'billing', rs.action
FROM (
  SELECT DISTINCT company_id FROM public.company_members
) cm
CROSS JOIN public.roles r
CROSS JOIN (
  VALUES ('view'), ('manage')
) AS rs(action)
WHERE (
  (r.name IN ('owner', 'admin') AND rs.action IN ('view', 'manage'))
  OR (r.name IN ('manager', 'staff', 'viewer') AND rs.action = 'view')
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- STEP 3: Update seed_default_permissions for future companies
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
    -- ── Owner: full access to everything ──
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
    (p_company_id, v_owner_id, 'conversation_statuses', 'view'),
    (p_company_id, v_owner_id, 'conversation_statuses', 'create'),
    (p_company_id, v_owner_id, 'conversation_statuses', 'edit'),
    (p_company_id, v_owner_id, 'conversation_statuses', 'delete'),
    (p_company_id, v_owner_id, 'canned_responses', 'view'),
    (p_company_id, v_owner_id, 'canned_responses', 'create'),
    (p_company_id, v_owner_id, 'canned_responses', 'edit'),
    (p_company_id, v_owner_id, 'canned_responses', 'delete'),
    (p_company_id, v_owner_id, 'channels', 'view'),
    (p_company_id, v_owner_id, 'channels', 'create'),
    (p_company_id, v_owner_id, 'channels', 'edit'),
    (p_company_id, v_owner_id, 'channels', 'delete'),
    (p_company_id, v_owner_id, 'ai_settings', 'view'),
    (p_company_id, v_owner_id, 'ai_settings', 'create'),
    (p_company_id, v_owner_id, 'ai_settings', 'edit'),
    (p_company_id, v_owner_id, 'ai_settings', 'delete'),
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
    (p_company_id, v_owner_id, 'billing', 'view'),
    (p_company_id, v_owner_id, 'billing', 'manage'),
    (p_company_id, v_owner_id, 'team', 'view'),
    (p_company_id, v_owner_id, 'team', 'invite'),
    (p_company_id, v_owner_id, 'team', 'edit_role'),
    (p_company_id, v_owner_id, 'team', 'remove'),
    (p_company_id, v_owner_id, 'company_settings', 'view'),
    (p_company_id, v_owner_id, 'company_settings', 'edit'),
    (p_company_id, v_owner_id, 'role_permissions', 'view'),
    (p_company_id, v_owner_id, 'role_permissions', 'edit'),

    -- ── Admin: same as owner except team.remove ──
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
    (p_company_id, v_admin_id, 'conversation_statuses', 'view'),
    (p_company_id, v_admin_id, 'conversation_statuses', 'create'),
    (p_company_id, v_admin_id, 'conversation_statuses', 'edit'),
    (p_company_id, v_admin_id, 'conversation_statuses', 'delete'),
    (p_company_id, v_admin_id, 'canned_responses', 'view'),
    (p_company_id, v_admin_id, 'canned_responses', 'create'),
    (p_company_id, v_admin_id, 'canned_responses', 'edit'),
    (p_company_id, v_admin_id, 'canned_responses', 'delete'),
    (p_company_id, v_admin_id, 'channels', 'view'),
    (p_company_id, v_admin_id, 'channels', 'create'),
    (p_company_id, v_admin_id, 'channels', 'edit'),
    (p_company_id, v_admin_id, 'channels', 'delete'),
    (p_company_id, v_admin_id, 'ai_settings', 'view'),
    (p_company_id, v_admin_id, 'ai_settings', 'create'),
    (p_company_id, v_admin_id, 'ai_settings', 'edit'),
    (p_company_id, v_admin_id, 'ai_settings', 'delete'),
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
    (p_company_id, v_admin_id, 'billing', 'view'),
    (p_company_id, v_admin_id, 'billing', 'manage'),
    (p_company_id, v_admin_id, 'team', 'view'),
    (p_company_id, v_admin_id, 'team', 'invite'),
    (p_company_id, v_admin_id, 'team', 'edit_role'),
    (p_company_id, v_admin_id, 'team', 'remove'),
    (p_company_id, v_admin_id, 'company_settings', 'view'),
    (p_company_id, v_admin_id, 'company_settings', 'edit'),
    (p_company_id, v_admin_id, 'role_permissions', 'view'),
    (p_company_id, v_admin_id, 'role_permissions', 'edit'),

    -- ── Manager: mid-tier ──
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
    (p_company_id, v_manager_id, 'conversation_statuses', 'view'),
    (p_company_id, v_manager_id, 'conversation_statuses', 'create'),
    (p_company_id, v_manager_id, 'conversation_statuses', 'edit'),
    (p_company_id, v_manager_id, 'conversation_statuses', 'delete'),
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
    (p_company_id, v_manager_id, 'billing', 'view'),
    (p_company_id, v_manager_id, 'team', 'view'),

    -- ── Staff: basic access ──
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
    (p_company_id, v_staff_id, 'conversation_statuses', 'view'),
    (p_company_id, v_staff_id, 'canned_responses', 'view'),
    (p_company_id, v_staff_id, 'channels', 'view'),
    (p_company_id, v_staff_id, 'ai_settings', 'view'),
    (p_company_id, v_staff_id, 'knowledge_base', 'view'),
    (p_company_id, v_staff_id, 'labels', 'view'),
    (p_company_id, v_staff_id, 'custom_fields', 'view'),
    (p_company_id, v_staff_id, 'billing', 'view'),

    -- ── Viewer: read-only ──
    (p_company_id, v_viewer_id, 'conversations', 'view'),
    (p_company_id, v_viewer_id, 'messages', 'view'),
    (p_company_id, v_viewer_id, 'contacts', 'view'),
    (p_company_id, v_viewer_id, 'contact_notes', 'view'),
    (p_company_id, v_viewer_id, 'contact_tags', 'view'),
    (p_company_id, v_viewer_id, 'contact_lists', 'view'),
    (p_company_id, v_viewer_id, 'conversation_notes', 'view'),
    (p_company_id, v_viewer_id, 'conversation_statuses', 'view'),
    (p_company_id, v_viewer_id, 'canned_responses', 'view'),
    (p_company_id, v_viewer_id, 'channels', 'view'),
    (p_company_id, v_viewer_id, 'labels', 'view'),
    (p_company_id, v_viewer_id, 'custom_fields', 'view'),
    (p_company_id, v_viewer_id, 'billing', 'view')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STEP 4: Improve conversation_statuses RLS policies
-- Replace the single FOR ALL policy with granular per-operation policies
-- ============================================================

DROP POLICY IF EXISTS "conversation_statuses_company_access" ON public.conversation_statuses;

CREATE POLICY "conversation_statuses_select"
  ON public.conversation_statuses FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversation_statuses', 'view')
  );

CREATE POLICY "conversation_statuses_insert"
  ON public.conversation_statuses FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversation_statuses', 'create')
  );

CREATE POLICY "conversation_statuses_update"
  ON public.conversation_statuses FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversation_statuses', 'edit')
  );

CREATE POLICY "conversation_statuses_delete"
  ON public.conversation_statuses FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('conversation_statuses', 'delete')
  );
