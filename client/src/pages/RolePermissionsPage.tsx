import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { RotateCcw, Save, Shield, Loader2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────

interface Role {
  id: string;
  name: string;
  description: string | null;
  hierarchy_level: number;
}

interface RoleMatrixEntry {
  role_id: string;
  role_name: string;
  hierarchy_level: number;
  permissions: Array<{ resource: string; action: string }>;
}

interface PendingChange {
  role_id: string;
  resource: string;
  action: string;
  enabled: boolean;
}

// ─── Resource / Action Definitions ───────────────────────────────

const RESOURCE_ACTIONS: Record<string, string[]> = {
  conversations: ['view', 'create', 'edit', 'delete'],
  messages: ['view', 'create'],
  contacts: ['view', 'create', 'edit', 'delete'],
  contact_notes: ['view', 'create', 'edit', 'delete'],
  channels: ['view', 'create', 'edit', 'delete'],
  ai_settings: ['view', 'edit'],
  knowledge_base: ['view', 'create', 'edit', 'delete'],
  labels: ['view', 'create', 'edit', 'delete'],
  team: ['view', 'invite', 'edit_role', 'remove'],
  company_settings: ['view', 'edit'],
  role_permissions: ['view', 'edit'],
};

interface ResourceGroup {
  label: string;
  resources: string[];
}

const RESOURCE_GROUPS: ResourceGroup[] = [
  {
    label: 'Data',
    resources: ['conversations', 'messages', 'contacts', 'contact_notes'],
  },
  {
    label: 'Content',
    resources: ['channels', 'ai_settings', 'knowledge_base', 'labels'],
  },
  {
    label: 'Administration',
    resources: ['team', 'company_settings', 'role_permissions'],
  },
];

/** Display labels for resources */
const RESOURCE_LABELS: Record<string, string> = {
  conversations: 'Conversations',
  messages: 'Messages',
  contacts: 'Contacts',
  contact_notes: 'Contact Notes',
  channels: 'Channels',
  ai_settings: 'AI Settings',
  knowledge_base: 'Knowledge Base',
  labels: 'Labels',
  team: 'Team',
  company_settings: 'Company Settings',
  role_permissions: 'Role Permissions',
};

/** Display labels for actions */
const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  invite: 'Invite',
  edit_role: 'Edit Role',
  remove: 'Remove',
};

/** Unique key for a permission change */
function changeKey(roleId: string, resource: string, action: string): string {
  return `${roleId}:${resource}:${action}`;
}

// ─── Role column order (hierarchy descending) ────────────────────

const ROLE_ORDER = ['owner', 'admin', 'manager', 'staff', 'viewer'];

// ─── Component ───────────────────────────────────────────────────

export default function RolePermissionsPage() {
  const { role: currentUserRole, hasPermission } = useSession();

  const [roles, setRoles] = useState<Role[]>([]);
  const [matrix, setMatrix] = useState<Record<string, RoleMatrixEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [resettingRoleId, setResettingRoleId] = useState<string | null>(null);
  const saveBarRef = useRef<HTMLDivElement>(null);

  // ─── Derived: current user hierarchy level ───────

  const currentUserHierarchy = useMemo(() => {
    const match = roles.find((r) => r.name === currentUserRole);
    return match?.hierarchy_level ?? 0;
  }, [roles, currentUserRole]);

  // ─── Sorted roles for columns ────────────────────

  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const ai = ROLE_ORDER.indexOf(a.name);
      const bi = ROLE_ORDER.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [roles]);

  // ─── Data fetching ───────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [rolesRes, permRes] = await Promise.all([
        api.get<{ roles: Role[] }>('/roles'),
        api.get<{ matrix: Record<string, RoleMatrixEntry> }>('/roles/permissions'),
      ]);
      setRoles(rolesRes.data.roles || []);
      setMatrix(permRes.data.matrix || {});
    } catch (err) {
      console.error('Failed to load roles/permissions:', err);
      toast.error('Failed to load role permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Permission helpers ──────────────────────────

  /** Check if a role currently has a specific permission (considering pending changes) */
  const hasRolePermission = useCallback(
    (roleId: string, roleName: string, resource: string, action: string): boolean => {
      const key = changeKey(roleId, resource, action);
      const pending = pendingChanges.get(key);
      if (pending !== undefined) {
        return pending.enabled;
      }
      // Check the matrix from the API
      const entry = matrix[roleName];
      if (!entry) return false;
      return entry.permissions.some((p) => p.resource === resource && p.action === action);
    },
    [matrix, pendingChanges],
  );

  /** Whether the current user can edit a given role's permissions */
  const canEditRole = useCallback(
    (role: Role): boolean => {
      if (role.name === 'owner') return false;
      if (!hasPermission('role_permissions', 'edit')) return false;
      return role.hierarchy_level < currentUserHierarchy;
    },
    [currentUserHierarchy, hasPermission],
  );

  // ─── Toggle handler ──────────────────────────────

  const handleToggle = useCallback(
    (role: Role, resource: string, action: string) => {
      if (!canEditRole(role)) return;

      const key = changeKey(role.id, resource, action);
      const currentValue = hasRolePermission(role.id, role.name, resource, action);
      const newValue = !currentValue;

      setPendingChanges((prev) => {
        const next = new Map(prev);

        // Check if this change reverts to the original API state
        const entry = matrix[role.name];
        const originalValue = entry
          ? entry.permissions.some((p) => p.resource === resource && p.action === action)
          : false;

        if (newValue === originalValue) {
          // Revert — remove from pending
          next.delete(key);
        } else {
          next.set(key, {
            role_id: role.id,
            resource,
            action,
            enabled: newValue,
          });
        }

        return next;
      });
    },
    [canEditRole, hasRolePermission, matrix],
  );

  // ─── Save handler ────────────────────────────────

  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);

    try {
      // Group pending changes by role_id
      const byRole = new Map<string, Array<{ resource: string; action: string; enabled: boolean }>>();
      for (const change of pendingChanges.values()) {
        const existing = byRole.get(change.role_id) || [];
        existing.push({
          resource: change.resource,
          action: change.action,
          enabled: change.enabled,
        });
        byRole.set(change.role_id, existing);
      }

      // Send one PUT per role
      const promises = Array.from(byRole.entries()).map(([role_id, permissions]) =>
        api.put('/roles/permissions', { role_id, permissions }),
      );

      await Promise.all(promises);

      toast.success('Permissions updated successfully');
      setPendingChanges(new Map());

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Failed to save permissions:', err);
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, fetchData]);

  // ─── Reset handler ───────────────────────────────

  const handleReset = useCallback(
    async (role: Role) => {
      if (!canEditRole(role)) return;

      setResettingRoleId(role.id);
      try {
        await api.post('/roles/permissions/reset', { role_id: role.id });

        // Clear any pending changes for this role
        setPendingChanges((prev) => {
          const next = new Map(prev);
          for (const [key, change] of next) {
            if (change.role_id === role.id) {
              next.delete(key);
            }
          }
          return next;
        });

        toast.success(`${role.name} permissions reset to defaults`);
        await fetchData();
      } catch (err) {
        console.error('Failed to reset permissions:', err);
        toast.error('Failed to reset permissions');
      } finally {
        setResettingRoleId(null);
      }
    },
    [canEditRole, fetchData],
  );

  // ─── Discard handler ─────────────────────────────

  const handleDiscard = useCallback(() => {
    setPendingChanges(new Map());
  }, []);

  // ─── Collect all unique actions across all resources (for column sub-headers) ─
  // We show per-resource actions inline, so we don't need global action columns.

  // ─── Loading state ───────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-[600px] rounded-xl" />
      </div>
    );
  }

  const pendingCount = pendingChanges.size;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Role Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Configure what each role can access and modify across the platform.
          </p>
        </div>
      </div>

      {/* Matrix Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* ─── Header ─────────────────────── */}
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b">
                  {/* Resource / Action column */}
                  <th className="sticky left-0 z-20 min-w-[200px] bg-background px-4 py-3 text-left font-medium text-muted-foreground">
                    Resource / Action
                  </th>

                  {/* Role columns */}
                  {sortedRoles.map((role) => {
                    const editable = canEditRole(role);
                    return (
                      <th
                        key={role.id}
                        className="min-w-[140px] px-3 py-3 text-center"
                      >
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium capitalize">{role.name}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {role.hierarchy_level}
                            </Badge>
                          </div>
                          {editable && (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="h-6 gap-1 text-[11px] text-muted-foreground"
                              disabled={resettingRoleId === role.id}
                              onClick={() => handleReset(role)}
                            >
                              {resettingRoleId === role.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RotateCcw className="size-3" />
                              )}
                              Reset
                            </Button>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* ─── Body ──────────────────────── */}
              <tbody>
                {RESOURCE_GROUPS.map((group, groupIdx) => (
                  <GroupRows
                    key={group.label}
                    group={group}
                    sortedRoles={sortedRoles}
                    hasRolePermission={hasRolePermission}
                    canEditRole={canEditRole}
                    onToggle={handleToggle}
                    isLastGroup={groupIdx === RESOURCE_GROUPS.length - 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Floating Save Bar ──────────────────── */}
      {pendingCount > 0 && (
        <div
          ref={saveBarRef}
          className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-6 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{pendingCount}</span>{' '}
              unsaved {pendingCount === 1 ? 'change' : 'changes'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group Rows Sub-component ──────────────────────────────────

interface GroupRowsProps {
  group: ResourceGroup;
  sortedRoles: Role[];
  hasRolePermission: (roleId: string, roleName: string, resource: string, action: string) => boolean;
  canEditRole: (role: Role) => boolean;
  onToggle: (role: Role, resource: string, action: string) => void;
  isLastGroup: boolean;
}

function GroupRows({
  group,
  sortedRoles,
  hasRolePermission,
  canEditRole,
  onToggle,
  isLastGroup,
}: GroupRowsProps) {
  return (
    <>
      {/* Group header row */}
      <tr>
        <td
          colSpan={sortedRoles.length + 1}
          className="bg-muted/40 px-4 py-2"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </span>
        </td>
      </tr>

      {/* Resource rows */}
      {group.resources.map((resource, resIdx) => {
        const actions = RESOURCE_ACTIONS[resource] || [];
        const isLastResource = resIdx === group.resources.length - 1;

        return (
          <tr
            key={resource}
            className={
              !isLastResource || !isLastGroup ? 'border-b border-border/50' : ''
            }
          >
            {/* Resource name + action labels */}
            <td className="sticky left-0 z-10 bg-background px-4 py-2.5 align-top">
              <div className="font-medium text-foreground">
                {RESOURCE_LABELS[resource] || resource}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {actions.map((action) => (
                  <span
                    key={action}
                    className="text-[11px] text-muted-foreground"
                  >
                    {ACTION_LABELS[action] || action}
                  </span>
                ))}
              </div>
            </td>

            {/* Role cells */}
            {sortedRoles.map((role) => {
              const editable = canEditRole(role);
              const isOwner = role.name === 'owner';

              return (
                <td
                  key={role.id}
                  className="px-3 py-2.5 align-top"
                >
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
                    {actions.map((action) => {
                      const checked = isOwner
                        ? true
                        : hasRolePermission(role.id, role.name, resource, action);
                      const disabled = isOwner || !editable;

                      return (
                        <div
                          key={action}
                          className="flex flex-col items-center gap-0.5"
                          title={`${role.name}: ${resource}.${action}`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => {
                              if (!disabled) {
                                onToggle(role, resource, action);
                              }
                            }}
                            className={
                              isOwner
                                ? 'data-[state=checked]:bg-muted-foreground data-[state=checked]:border-muted-foreground'
                                : ''
                            }
                          />
                          <span className="text-[10px] leading-none text-muted-foreground">
                            {ACTION_LABELS[action] || action}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}

      {/* Separator between groups */}
      {!isLastGroup && (
        <tr>
          <td colSpan={sortedRoles.length + 1} className="p-0">
            <Separator />
          </td>
        </tr>
      )}
    </>
  );
}
