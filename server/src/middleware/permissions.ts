import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

// In-memory cache: Map<companyId, Map<roleName, Set<"resource.action">>>
const permissionCache = new Map<string, Map<string, Set<string>>>();

/**
 * Load permissions for a company into the cache.
 */
async function loadCompanyPermissions(companyId: string): Promise<Map<string, Set<string>>> {
  const { data } = await supabaseAdmin
    .from('role_permissions')
    .select('resource, action, roles(name)')
    .eq('company_id', companyId);

  const roleMap = new Map<string, Set<string>>();

  for (const row of data || []) {
    const roleName = (row.roles as unknown as { name: string })?.name;
    if (!roleName) continue;

    if (!roleMap.has(roleName)) roleMap.set(roleName, new Set());
    roleMap.get(roleName)!.add(`${row.resource}.${row.action}`);
  }

  permissionCache.set(companyId, roleMap);
  return roleMap;
}

/**
 * Check if a role has a specific permission for a company.
 */
async function checkPermission(
  companyId: string,
  roleName: string,
  resource: string,
  action: string
): Promise<boolean> {
  // Owner always has full access (immutable)
  if (roleName === 'owner') return true;

  let roleMap = permissionCache.get(companyId);
  if (!roleMap) {
    roleMap = await loadCompanyPermissions(companyId);
  }

  const perms = roleMap.get(roleName);
  return perms?.has(`${resource}.${action}`) ?? false;
}

/**
 * Invalidate the permission cache for a company.
 * Call this when role permissions are updated.
 */
export function invalidatePermissionCache(companyId: string): void {
  permissionCache.delete(companyId);
}

/**
 * Middleware factory: requires a specific permission.
 * Must be used after requireAuth middleware.
 */
export function requirePermission(resource: string, action: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { companyId, userRole } = req;

    if (!companyId || !userRole) {
      res.status(403).json({ error: 'No company membership found' });
      return;
    }

    const allowed = await checkPermission(companyId, userRole, resource, action);

    if (!allowed) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: `${resource}.${action}`,
      });
      return;
    }

    next();
  };
}
