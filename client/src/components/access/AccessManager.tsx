import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Check, Lock, Globe, Users, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AccessEntry } from '@/hooks/useAccessControl';
import type { TeamMember } from '@/hooks/useTeamMembers';

type SharingMode = 'private' | 'specific_users' | 'all_members';

interface AccessManagerProps {
  /** Title shown in the dialog header */
  title: string;
  /** Description shown below the title */
  description: string;
  /** Current sharing mode */
  sharingMode: SharingMode;
  /** Current access list (users with explicit access) */
  accessList: AccessEntry[];
  /** All team members available to grant access to */
  teamMembers: TeamMember[];
  /** Callback to update sharing mode */
  onSharingModeChange: (mode: SharingMode) => Promise<void>;
  /** Callback to grant access to a user */
  onGrantAccess: (userId: string, level: 'view' | 'edit') => Promise<void>;
  /** Callback to revoke access from a user */
  onRevokeAccess: (userId: string) => Promise<void>;
  /** Whether to show conversation-level "Grant to all" option */
  showGrantToAll?: boolean;
  /** Callback for granting to all shared users */
  onGrantToAll?: (level: 'view' | 'edit') => Promise<void>;
  /** Callback for revoking from all */
  onRevokeFromAll?: () => Promise<void>;
  /** Whether there's an "all" entry in the access list */
  hasAllAccess?: boolean;
  /** The trigger button (optional — defaults to a lock icon button) */
  trigger?: React.ReactNode;
}

const SHARING_MODE_OPTIONS = [
  {
    value: 'private' as const,
    label: 'Private',
    description: 'Only you can see this',
    icon: Lock,
  },
  {
    value: 'specific_users' as const,
    label: 'Specific people',
    description: 'Only people you choose',
    icon: Users,
  },
  {
    value: 'all_members' as const,
    label: 'All team members',
    description: 'Everyone on the team',
    icon: Globe,
  },
];

export default function AccessManager({
  title,
  description,
  sharingMode,
  accessList,
  teamMembers,
  onSharingModeChange,
  onGrantAccess,
  onRevokeAccess,
  showGrantToAll,
  onGrantToAll,
  onRevokeFromAll,
  hasAllAccess,
  trigger,
}: AccessManagerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  const accessUserIds = new Set(accessList.map((a) => a.user_id));
  const availableMembers = teamMembers.filter((m) => !accessUserIds.has(m.user_id));

  const handleSharingModeChange = async (mode: SharingMode) => {
    setLoading(true);
    try {
      await onSharingModeChange(mode);
    } catch {
      toast.error('Failed to update access settings');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async (userId: string, level: 'view' | 'edit') => {
    setAddingUserId(userId);
    try {
      await onGrantAccess(userId, level);
      toast.success('Access granted');
    } catch {
      toast.error('Failed to grant access');
    } finally {
      setAddingUserId(null);
    }
  };

  const handleRevokeAccess = async (userId: string) => {
    try {
      await onRevokeAccess(userId);
      toast.success('Access revoked');
    } catch {
      toast.error('Failed to revoke access');
    }
  };

  const handleGrantToAll = async (level: 'view' | 'edit') => {
    if (!onGrantToAll) return;
    setLoading(true);
    try {
      await onGrantToAll(level);
      toast.success('Access granted to all team members');
    } catch {
      toast.error('Failed to grant access');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeFromAll = async () => {
    if (!onRevokeFromAll) return;
    setLoading(true);
    try {
      await onRevokeFromAll();
      toast.success('Access revoked from all');
    } catch {
      toast.error('Failed to revoke access');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Manage access">
            <Lock className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sharing Mode */}
          <div>
            <label className="mb-2 block text-sm font-medium">Who has access</label>
            <div className="space-y-2">
              {SHARING_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = sharingMode === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSharingModeChange(option.value)}
                    disabled={loading}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                    {isActive && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* User access list (for specific_users mode) */}
          {sharingMode === 'specific_users' && (
            <>
              <Separator />

              {/* Grant to all option (for conversations) */}
              {showGrantToAll && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">All team members</div>
                    <div className="text-xs text-muted-foreground">
                      {hasAllAccess
                        ? 'Everyone with channel access can see this'
                        : 'Grant access to everyone with channel access'}
                    </div>
                  </div>
                  {hasAllAccess ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRevokeFromAll}
                      disabled={loading}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Revoke
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGrantToAll('view')}
                        disabled={loading}
                      >
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGrantToAll('edit')}
                        disabled={loading}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Current access entries */}
              {accessList.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">People with access</label>
                  {accessList.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg border p-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          {entry.user?.full_name || 'Unknown'}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.user?.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {entry.access_level === 'edit' ? 'Can edit' : 'Can view'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRevokeAccess(entry.user_id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new user */}
              {availableMembers.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Add people</label>
                  {availableMembers.map((member) => (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between rounded-lg border p-2 mb-1"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{member.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {member.email}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {addingUserId === member.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleGrantAccess(member.user_id, 'view')}
                            >
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleGrantAccess(member.user_id, 'edit')}
                            >
                              Edit
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
