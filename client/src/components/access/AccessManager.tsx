import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Check, Lock, Globe, Users, UserPlus, X, Shield } from 'lucide-react';
import { toast } from 'sonner';
import PermissionLevelSelect from '@/components/access/PermissionLevelSelect';
import type { AccessLevel, PermissionEntry } from '@/hooks/usePermissions';
import type { TeamMember } from '@/hooks/useTeamMembers';

type ChannelMode = 'private' | 'specific_users' | 'all_members';

interface AccessManagerProps {
  mode: 'channel' | 'conversation';
  // Channel mode props
  channelMode?: ChannelMode;
  defaultLevel?: AccessLevel;
  onChannelModeChange?: (mode: string, level?: AccessLevel) => void;
  // Shared props
  permissions: PermissionEntry[];
  inheritedPermissions?: PermissionEntry[];
  teamMembers: TeamMember[];
  ownerId?: string;
  onGrant: (userId: string | 'all', level: AccessLevel) => Promise<void>;
  onRevoke: (userId: string | 'all') => Promise<void>;
  onLevelChange?: (userId: string | 'all', level: AccessLevel) => Promise<void>;
  trigger?: React.ReactNode;
  canManage: boolean;
}

const CHANNEL_MODE_OPTIONS = [
  {
    value: 'private' as const,
    label: 'Private',
    description: 'Only the owner can see this channel',
    icon: Lock,
  },
  {
    value: 'all_members' as const,
    label: 'All team members',
    description: 'Everyone on the team can access',
    icon: Globe,
  },
  {
    value: 'specific_users' as const,
    label: 'Specific people',
    description: 'Only people you choose',
    icon: Users,
  },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function AccessManager({
  mode,
  channelMode,
  defaultLevel,
  onChannelModeChange,
  permissions,
  inheritedPermissions,
  teamMembers,
  ownerId,
  onGrant,
  onRevoke,
  onLevelChange,
  trigger,
  canManage,
}: AccessManagerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Find owner from team members
  const ownerMember = teamMembers.find((m) => m.user_id === ownerId);

  // Users already in the permission list (including inherited)
  const existingUserIds = new Set([
    ...permissions.filter((p) => p.user_id).map((p) => p.user_id!),
    ...(inheritedPermissions || []).filter((p) => p.user_id).map((p) => p.user_id!),
  ]);
  if (ownerId) existingUserIds.add(ownerId);

  const availableMembers = teamMembers
    .filter((m) => !existingUserIds.has(m.user_id))
    .filter(
      (m) =>
        !searchQuery ||
        m.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const handleChannelModeChange = async (newMode: ChannelMode) => {
    if (!onChannelModeChange) return;
    setLoading(true);
    try {
      if (newMode === 'all_members') {
        onChannelModeChange(newMode, defaultLevel || 'view');
      } else {
        onChannelModeChange(newMode);
      }
    } catch {
      toast.error('Failed to update access settings');
    } finally {
      setLoading(false);
    }
  };

  const handleDefaultLevelChange = (level: AccessLevel) => {
    if (!onChannelModeChange) return;
    onChannelModeChange('all_members', level);
  };

  const handleLevelChange = async (userId: string | 'all', level: AccessLevel) => {
    try {
      if (onLevelChange) {
        await onLevelChange(userId, level);
      } else {
        await onGrant(userId, level);
      }
    } catch {
      toast.error('Failed to update permission level');
    }
  };

  const handleGrant = async (userId: string, level: AccessLevel) => {
    try {
      await onGrant(userId, level);
      setAddPopoverOpen(false);
      setSearchQuery('');
      toast.success('Access granted');
    } catch {
      toast.error('Failed to grant access');
    }
  };

  const handleRevoke = async (userId: string | 'all') => {
    try {
      await onRevoke(userId);
      toast.success('Access revoked');
    } catch {
      toast.error('Failed to revoke access');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Shield className="mr-1.5 h-3.5 w-3.5" />
            Manage access
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'channel' ? 'Channel Access' : 'Conversation Access'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Channel mode: Radio selection for access type */}
          {mode === 'channel' && canManage && (
            <div>
              <label className="mb-2 block text-sm font-medium">Who has access</label>
              <div className="space-y-2">
                {CHANNEL_MODE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isActive = channelMode === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleChannelModeChange(option.value)}
                      disabled={loading}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                      />
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
          )}

          {/* Channel mode: Default level for all_members */}
          {mode === 'channel' && channelMode === 'all_members' && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Default permission level</div>
                <div className="text-xs text-muted-foreground">
                  Applies to all team members
                </div>
              </div>
              {canManage ? (
                <PermissionLevelSelect
                  value={defaultLevel || 'view'}
                  onChange={handleDefaultLevelChange}
                  showNoAccess={false}
                  size="sm"
                />
              ) : (
                <Badge variant="outline" className="text-xs capitalize">
                  {defaultLevel || 'view'}
                </Badge>
              )}
            </div>
          )}

          {/* Conversation mode: Inherited channel level */}
          {mode === 'conversation' && defaultLevel && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Inherits from channel</span>
              </div>
              <Badge variant="secondary" className="text-xs capitalize">
                {defaultLevel}
              </Badge>
            </div>
          )}

          <Separator />

          {/* Permission list */}
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
            {/* Owner row (channel mode) */}
            {mode === 'channel' && ownerMember && (
              <div className="flex items-center gap-3 rounded-lg border p-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={ownerMember.avatar_url || undefined} />
                  <AvatarFallback>{getInitials(ownerMember.full_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{ownerMember.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {ownerMember.email}
                  </div>
                </div>
                <Badge variant="default" className="text-xs">
                  Owner
                </Badge>
              </div>
            )}

            {/* Inherited permissions (conversation mode) */}
            {mode === 'conversation' &&
              inheritedPermissions?.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={entry.user?.avatar_url || undefined} />
                    <AvatarFallback>
                      {entry.user ? getInitials(entry.user.full_name) : '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {entry.user?.full_name || 'All members'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.user?.email || 'Default channel access'}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    from channel
                  </Badge>
                  <Badge variant="outline" className="text-xs capitalize">
                    {entry.access_level}
                  </Badge>
                </div>
              ))}

            {/* Active permission entries */}
            {permissions.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={entry.user?.avatar_url || undefined} />
                  <AvatarFallback>
                    {entry.user ? getInitials(entry.user.full_name) : '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm">
                      {entry.user?.full_name || (entry.user_id === null ? 'All members' : 'Unknown')}
                    </span>
                    {mode === 'conversation' && (
                      <Badge variant="outline" className="text-xs">
                        override
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.user?.email || (entry.user_id === null ? 'Team-wide override' : '')}
                  </div>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <PermissionLevelSelect
                      value={entry.access_level}
                      onChange={(level) =>
                        handleLevelChange(entry.user_id || 'all', level)
                      }
                      showNoAccess={mode === 'conversation'}
                      size="sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRevoke(entry.user_id || 'all')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-xs capitalize">
                    {entry.access_level}
                  </Badge>
                )}
              </div>
            ))}

            {permissions.length === 0 &&
              (!inheritedPermissions || inheritedPermissions.length === 0) &&
              !(mode === 'channel' && ownerMember) && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No permissions configured
                </div>
              )}
          </div>

          {/* Add user */}
          {canManage && (
            <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  {mode === 'conversation' ? 'Add override' : 'Add user'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-2" align="start">
                <Input
                  placeholder="Search team members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-[200px] space-y-1 overflow-y-auto">
                  {availableMembers.length === 0 ? (
                    <div className="py-3 text-center text-sm text-muted-foreground">
                      {searchQuery ? 'No matching members' : 'All members have access'}
                    </div>
                  ) : (
                    availableMembers.map((member) => (
                      <button
                        key={member.user_id}
                        className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted"
                        onClick={() => handleGrant(member.user_id, 'view')}
                      >
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={member.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{member.full_name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {member.email}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
