import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { requirePermission, invalidatePermissionCache } from '../middleware/permissions.js';

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────
// DEFAULT PERMISSIONS MAP (mirrors seed_default_permissions)
// ────────────────────────────────────────────────
const DEFAULT_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  owner: [
    { resource: 'conversations', action: 'view' },
    { resource: 'conversations', action: 'create' },
    { resource: 'conversations', action: 'edit' },
    { resource: 'conversations', action: 'delete' },
    { resource: 'messages', action: 'view' },
    { resource: 'messages', action: 'create' },
    { resource: 'contacts', action: 'view' },
    { resource: 'contacts', action: 'create' },
    { resource: 'contacts', action: 'edit' },
    { resource: 'contacts', action: 'delete' },
    { resource: 'contact_notes', action: 'view' },
    { resource: 'contact_notes', action: 'create' },
    { resource: 'contact_notes', action: 'edit' },
    { resource: 'contact_notes', action: 'delete' },
    { resource: 'channels', action: 'view' },
    { resource: 'channels', action: 'create' },
    { resource: 'channels', action: 'edit' },
    { resource: 'channels', action: 'delete' },
    { resource: 'ai_settings', action: 'view' },
    { resource: 'ai_settings', action: 'edit' },
    { resource: 'knowledge_base', action: 'view' },
    { resource: 'knowledge_base', action: 'create' },
    { resource: 'knowledge_base', action: 'edit' },
    { resource: 'knowledge_base', action: 'delete' },
    { resource: 'labels', action: 'view' },
    { resource: 'labels', action: 'create' },
    { resource: 'labels', action: 'edit' },
    { resource: 'labels', action: 'delete' },
    { resource: 'team', action: 'view' },
    { resource: 'team', action: 'invite' },
    { resource: 'team', action: 'edit_role' },
    { resource: 'team', action: 'remove' },
    { resource: 'company_settings', action: 'view' },
    { resource: 'company_settings', action: 'edit' },
    { resource: 'role_permissions', action: 'view' },
    { resource: 'role_permissions', action: 'edit' },
  ],
  admin: [
    { resource: 'conversations', action: 'view' },
    { resource: 'conversations', action: 'create' },
    { resource: 'conversations', action: 'edit' },
    { resource: 'conversations', action: 'delete' },
    { resource: 'messages', action: 'view' },
    { resource: 'messages', action: 'create' },
    { resource: 'contacts', action: 'view' },
    { resource: 'contacts', action: 'create' },
    { resource: 'contacts', action: 'edit' },
    { resource: 'contacts', action: 'delete' },
    { resource: 'contact_notes', action: 'view' },
    { resource: 'contact_notes', action: 'create' },
    { resource: 'contact_notes', action: 'edit' },
    { resource: 'contact_notes', action: 'delete' },
    { resource: 'channels', action: 'view' },
    { resource: 'channels', action: 'create' },
    { resource: 'channels', action: 'edit' },
    { resource: 'channels', action: 'delete' },
    { resource: 'ai_settings', action: 'view' },
    { resource: 'ai_settings', action: 'edit' },
    { resource: 'knowledge_base', action: 'view' },
    { resource: 'knowledge_base', action: 'create' },
    { resource: 'knowledge_base', action: 'edit' },
    { resource: 'knowledge_base', action: 'delete' },
    { resource: 'labels', action: 'view' },
    { resource: 'labels', action: 'create' },
    { resource: 'labels', action: 'edit' },
    { resource: 'labels', action: 'delete' },
    { resource: 'team', action: 'view' },
    { resource: 'team', action: 'invite' },
    { resource: 'team', action: 'edit_role' },
    { resource: 'company_settings', action: 'view' },
    { resource: 'company_settings', action: 'edit' },
    { resource: 'role_permissions', action: 'view' },
    { resource: 'role_permissions', action: 'edit' },
  ],
  manager: [
    { resource: 'conversations', action: 'view' },
    { resource: 'conversations', action: 'create' },
    { resource: 'conversations', action: 'edit' },
    { resource: 'messages', action: 'view' },
    { resource: 'messages', action: 'create' },
    { resource: 'contacts', action: 'view' },
    { resource: 'contacts', action: 'create' },
    { resource: 'contacts', action: 'edit' },
    { resource: 'contact_notes', action: 'view' },
    { resource: 'contact_notes', action: 'create' },
    { resource: 'contact_notes', action: 'edit' },
    { resource: 'channels', action: 'view' },
    { resource: 'ai_settings', action: 'view' },
    { resource: 'knowledge_base', action: 'view' },
    { resource: 'knowledge_base', action: 'create' },
    { resource: 'knowledge_base', action: 'edit' },
    { resource: 'labels', action: 'view' },
    { resource: 'labels', action: 'create' },
    { resource: 'labels', action: 'edit' },
  ],
  staff: [
    { resource: 'conversations', action: 'view' },
    { resource: 'conversations', action: 'create' },
    { resource: 'conversations', action: 'edit' },
    { resource: 'messages', action: 'view' },
    { resource: 'messages', action: 'create' },
    { resource: 'contacts', action: 'view' },
    { resource: 'contacts', action: 'create' },
    { resource: 'contact_notes', action: 'view' },
    { resource: 'contact_notes', action: 'create' },
    { resource: 'channels', action: 'view' },
    { resource: 'labels', action: 'view' },
  ],
  viewer: [
    { resource: 'conversations', action: 'view' },
    { resource: 'messages', action: 'view' },
    { resource: 'contacts', action: 'view' },
    { resource: 'contact_notes', action: 'view' },
    { resource: 'channels', action: 'view' },
    { resource: 'labels', action: 'view' },
  ],
};

// ────────────────────────────────────────────────
// LIST ALL ROLES
// ────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('roles')
      .select('*')
      .order('hierarchy_level', { ascending: false });

    if (error) throw error;
    res.json({ roles: data || [] });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET PERMISSION MATRIX FOR COMPANY
// ────────────────────────────────────────────────
router.get('/permissions', requirePermission('role_permissions', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('role_permissions')
      .select('*, roles:role_id(id, name, hierarchy_level)')
      .eq('company_id', companyId);

    if (error) throw error;

    // Group by role
    const matrix: Record<string, { role_id: string; role_name: string; hierarchy_level: number; permissions: { resource: string; action: string }[] }> = {};

    for (const row of data || []) {
      const role = row.roles as unknown as { id: string; name: string; hierarchy_level: number };
      if (!role) continue;

      if (!matrix[role.name]) {
        matrix[role.name] = {
          role_id: role.id,
          role_name: role.name,
          hierarchy_level: role.hierarchy_level,
          permissions: [],
        };
      }

      matrix[role.name].permissions.push({
        resource: row.resource,
        action: row.action,
      });
    }

    res.json({ matrix });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// UPDATE PERMISSIONS FOR A ROLE
// ────────────────────────────────────────────────
router.put('/permissions', requirePermission('role_permissions', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { role_id, permissions } = req.body;

    if (!role_id || !Array.isArray(permissions)) {
      res.status(400).json({ error: 'role_id and permissions array are required' });
      return;
    }

    // Get the target role
    const { data: targetRole, error: targetRoleError } = await supabaseAdmin
      .from('roles')
      .select('id, name, hierarchy_level')
      .eq('id', role_id)
      .single();

    if (targetRoleError || !targetRole) {
      res.status(400).json({ error: 'Invalid role_id' });
      return;
    }

    // Owner permissions are immutable
    if (targetRole.name === 'owner') {
      res.status(403).json({ error: 'Owner permissions cannot be modified' });
      return;
    }

    // Get the caller's hierarchy level
    const { data: callerMember, error: callerError } = await supabaseAdmin
      .from('company_members')
      .select('roles:role_id(hierarchy_level)')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .single();

    if (callerError || !callerMember) {
      res.status(403).json({ error: 'Could not verify your role' });
      return;
    }

    const callerLevel = (callerMember.roles as unknown as { hierarchy_level: number }).hierarchy_level;

    // Can only modify roles below you
    if (targetRole.hierarchy_level >= callerLevel) {
      res.status(403).json({ error: 'Cannot modify permissions for a role at or above your level' });
      return;
    }

    // Process each permission entry
    for (const perm of permissions as { resource: string; action: string; enabled: boolean }[]) {
      if (perm.enabled) {
        // Upsert: insert if not exists
        await supabaseAdmin
          .from('role_permissions')
          .upsert(
            {
              company_id: companyId,
              role_id,
              resource: perm.resource,
              action: perm.action,
            },
            { onConflict: 'company_id,role_id,resource,action' }
          );
      } else {
        // Delete
        await supabaseAdmin
          .from('role_permissions')
          .delete()
          .eq('company_id', companyId)
          .eq('role_id', role_id)
          .eq('resource', perm.resource)
          .eq('action', perm.action);
      }
    }

    invalidatePermissionCache(companyId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// RESET ROLE PERMISSIONS TO DEFAULTS
// ────────────────────────────────────────────────
router.post('/permissions/reset', requirePermission('role_permissions', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { role_id } = req.body;

    if (!role_id) {
      res.status(400).json({ error: 'role_id is required' });
      return;
    }

    // Get the target role
    const { data: targetRole, error: targetRoleError } = await supabaseAdmin
      .from('roles')
      .select('id, name, hierarchy_level')
      .eq('id', role_id)
      .single();

    if (targetRoleError || !targetRole) {
      res.status(400).json({ error: 'Invalid role_id' });
      return;
    }

    // Owner permissions are immutable
    if (targetRole.name === 'owner') {
      res.status(403).json({ error: 'Owner permissions cannot be modified' });
      return;
    }

    // Get the caller's hierarchy level
    const { data: callerMember, error: callerError } = await supabaseAdmin
      .from('company_members')
      .select('roles:role_id(hierarchy_level)')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .single();

    if (callerError || !callerMember) {
      res.status(403).json({ error: 'Could not verify your role' });
      return;
    }

    const callerLevel = (callerMember.roles as unknown as { hierarchy_level: number }).hierarchy_level;

    // Can only modify roles below you
    if (targetRole.hierarchy_level >= callerLevel) {
      res.status(403).json({ error: 'Cannot reset permissions for a role at or above your level' });
      return;
    }

    // Delete all existing permissions for this role in this company
    const { error: deleteError } = await supabaseAdmin
      .from('role_permissions')
      .delete()
      .eq('company_id', companyId)
      .eq('role_id', role_id);

    if (deleteError) throw deleteError;

    // Re-insert defaults for this role
    const defaults = DEFAULT_PERMISSIONS[targetRole.name];
    if (defaults && defaults.length > 0) {
      const rows = defaults.map((perm) => ({
        company_id: companyId,
        role_id,
        resource: perm.resource,
        action: perm.action,
      }));

      const { error: insertError } = await supabaseAdmin
        .from('role_permissions')
        .insert(rows);

      if (insertError) throw insertError;
    }

    invalidatePermissionCache(companyId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
