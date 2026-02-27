import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RotateCcw, Save, Shield, Loader2, Lock,
  Crown, UserCog, Users, User, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  invite: 'Invite',
  edit_role: 'Edit Role',
  remove: 'Remove',
};

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  owner: Crown,
  admin: Shield,
  manager: UserCog,
  staff: Users,
  viewer: Eye,
};

function changeKey(roleId: string, resource: string, action: string): string {
  return `${roleId}:${resource}:${action}`;
}

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
  const [selectedRoleName, setSelectedRoleName] = useState<string>('owner');

  const currentUserHierarchy = useMemo(() => {
    const match = roles.find((r) => r.name === currentUserRole);
    return match?.hierarchy_level ?? 0;
  }, [roles, currentUserRole]);

  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const ai = ROLE_ORDER.indexOf(a.name);
      const bi = ROLE_ORDER.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [roles]);

  const selectedRole = useMemo(
    () => sortedRoles.find((r) => r.name === selectedRoleName) || sortedRoles[0] || null,
    [sortedRoles, selectedRoleName],
  );

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

  const hasRolePermission = useCallback(
    (roleId: string, roleName: string, resource: string, action: string): boolean => {
      const key = changeKey(roleId, resource, action);
      const pending = pendingChanges.get(key);
      if (pending !== undefined) {
        return pending.enabled;
      }
      const entry = matrix[roleName];
      if (!entry) return false;
      return entry.permissions.some((p) => p.resource === resource && p.action === action);
    },
    [matrix, pendingChanges],
  );

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
        const entry = matrix[role.name];
        const originalValue = entry
          ? entry.permissions.some((p) => p.resource === resource && p.action === action)
          : false;

        if (newValue === originalValue) {
          next.delete(key);
        } else {
          next.set(key, { role_id: role.id, resource, action, enabled: newValue });
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
      const byRole = new Map<string, Array<{ resource: string; action: string; enabled: boolean }>>();
      for (const change of pendingChanges.values()) {
        const existing = byRole.get(change.role_id) || [];
        existing.push({ resource: change.resource, action: change.action, enabled: change.enabled });
        byRole.set(change.role_id, existing);
      }

      const promises = Array.from(byRole.entries()).map(([role_id, permissions]) =>
        api.put('/roles/permissions', { role_id, permissions }),
      );

      await Promise.all(promises);
      toast.success('Permissions updated successfully');
      setPendingChanges(new Map());
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

        setPendingChanges((prev) => {
          const next = new Map(prev);
          for (const [key, change] of next) {
            if (change.role_id === role.id) next.delete(key);
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

  const handleDiscard = useCallback(() => {
    setPendingChanges(new Map());
  }, []);

  // ─── Loading state ───────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const pendingCount = pendingChanges.size;
  const isOwner = selectedRole?.name === 'owner';
  const editable = selectedRole ? canEditRole(selectedRole) : false;

  return (
    <div className="space-y-8 pb-24">
      {/* Role selector cards */}
      <div className="grid grid-cols-5 gap-3">
        {sortedRoles.map((role) => {
          const Icon = ROLE_ICONS[role.name] || User;
          const isSelected = role.name === selectedRoleName;
          const rolePendingCount = Array.from(pendingChanges.values()).filter(
            (c) => c.role_id === role.id,
          ).length;

          return (
            <button
              key={role.id}
              onClick={() => setSelectedRoleName(role.name)}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-center transition-all',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-transparent bg-muted/40 hover:bg-muted/70',
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span
                className={cn(
                  'text-sm font-medium capitalize',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}
              >
                {role.name}
              </span>
              {rolePendingCount > 0 && (
                <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                  {rolePendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected role permissions */}
      {selectedRole && (
        <>
          {/* Role header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold capitalize">{selectedRole.name}</h2>
              {selectedRole.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{selectedRole.description}</p>
              )}
              {isOwner && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  Full access. Permissions cannot be changed.
                </p>
              )}
              {!isOwner && !editable && (
                <p className="mt-1 text-sm text-muted-foreground">
                  You don't have permission to edit this role.
                </p>
              )}
            </div>
            {editable && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={resettingRoleId === selectedRole.id}
                onClick={() => handleReset(selectedRole)}
              >
                {resettingRoleId === selectedRole.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Reset to Defaults
              </Button>
            )}
          </div>

          {/* Permission groups */}
          {RESOURCE_GROUPS.map((group) => (
            <div key={group.label} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-3">
                {group.resources.map((resource) => {
                  const actions = RESOURCE_ACTIONS[resource] || [];
                  return (
                    <Card key={resource}>
                      <CardContent className="px-5 py-4">
                        <p className="mb-3 text-sm font-medium">
                          {RESOURCE_LABELS[resource] || resource}
                        </p>
                        <div className="space-y-2.5">
                          {actions.map((action) => {
                            const checked = isOwner
                              ? true
                              : hasRolePermission(selectedRole.id, selectedRole.name, resource, action);
                            const disabled = isOwner || !editable;

                            return (
                              <div
                                key={action}
                                className="flex items-center justify-between"
                              >
                                <span className="text-sm text-muted-foreground">
                                  {ACTION_LABELS[action] || action}
                                </span>
                                <Switch
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={() => {
                                    if (!disabled) handleToggle(selectedRole, resource, action);
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Floating Save Bar */}
      {pendingCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-6 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
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
