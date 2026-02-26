import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// GET /api/me — returns user profile + company + role + permissions
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, avatar_url, company_id')
      .eq('id', userId)
      .single();

    if (!profile) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get company membership with role
    const { data: membership } = await supabaseAdmin
      .from('company_members')
      .select('company_id, role_id, roles(id, name, hierarchy_level), companies(id, name, slug, logo_url)')
      .eq('user_id', userId)
      .single();

    // Get permissions for the user's role in their company
    let permissions: string[] = [];
    if (membership) {
      const roleName = (membership.roles as any)?.name;

      if (roleName === 'owner') {
        // Owner has all permissions — return a comprehensive list
        const { data: allPerms } = await supabaseAdmin
          .from('role_permissions')
          .select('resource, action')
          .eq('company_id', membership.company_id)
          .eq('role_id', membership.role_id);
        permissions = (allPerms || []).map(p => `${p.resource}.${p.action}`);

        // Also add any permissions that might only exist for owner
        // (owner always has everything, we just return what's seeded for display purposes)
      } else if (membership.role_id) {
        const { data: rolePerms } = await supabaseAdmin
          .from('role_permissions')
          .select('resource, action')
          .eq('company_id', membership.company_id)
          .eq('role_id', membership.role_id);
        permissions = (rolePerms || []).map(p => `${p.resource}.${p.action}`);
      }
    }

    res.json({
      profile,
      company: membership ? (membership.companies as any) : null,
      role: membership ? (membership.roles as any) : null,
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
