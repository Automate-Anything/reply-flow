import { useState, useEffect, useCallback } from 'react';
import { Shuffle, Users, Tag, Plus, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAutoAssignRules, type AutoAssignRule } from '@/hooks/useAutoAssignRules';
import { useTeamMembers, type TeamMember } from '@/hooks/useTeamMembers';
import { type ChannelInfo, formatChannelName } from '@/components/settings/channelHelpers';

const STRATEGY_OPTIONS = [
  { value: 'round_robin', label: 'Round Robin', icon: Shuffle, description: 'Assign to each member in turn' },
  { value: 'least_busy', label: 'Least Busy', icon: Users, description: 'Assign to member with fewest open chats' },
  { value: 'tag_based', label: 'Tag-Based', icon: Tag, description: 'Route by contact tags, with round-robin fallback' },
] as const;

interface TagRoute {
  tag: string;
  user_id: string;
}

export default function AutoAssignSettings() {
  const { rules, loading: rulesLoading, createRule, updateRule, deleteRule } = useAutoAssignRules();
  const { members: teamMembers, loading: membersLoading } = useTeamMembers();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Fetch channels
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/whatsapp/channels');
        setChannels(data.channels || []);
      } catch {
        console.error('Failed to fetch channels');
      } finally {
        setChannelsLoading(false);
      }
    })();
  }, []);

  const loading = rulesLoading || membersLoading || channelsLoading;

  // Find rule for a given channel (or null for company-wide)
  const getRuleForChannel = useCallback(
    (channelId: number | null) => rules.find((r) => r.channel_id === channelId) || null,
    [rules]
  );

  const handleCreateRule = async (channelId: number | null) => {
    setSaving('new');
    try {
      await createRule({
        channel_id: channelId,
        strategy: 'round_robin',
        member_ids: teamMembers.map((m) => m.user_id),
      });
      toast.success('Auto-assign rule created');
    } catch {
      toast.error('Failed to create rule');
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateStrategy = async (rule: AutoAssignRule, strategy: string) => {
    setSaving(rule.id);
    try {
      const config = strategy === 'tag_based' ? { tag_routes: [], ...rule.config } : rule.config;
      await updateRule(rule.id, { strategy, config });
      toast.success('Strategy updated');
    } catch {
      toast.error('Failed to update strategy');
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (rule: AutoAssignRule) => {
    setSaving(rule.id);
    try {
      await updateRule(rule.id, { is_active: !rule.is_active });
      toast.success(rule.is_active ? 'Rule deactivated' : 'Rule activated');
    } catch {
      toast.error('Failed to toggle rule');
    } finally {
      setSaving(null);
    }
  };

  const handleToggleMember = async (rule: AutoAssignRule, userId: string) => {
    const currentIds = rule.members.map((m) => m.user_id);
    const isIncluded = currentIds.includes(userId);
    const newIds = isIncluded ? currentIds.filter((id) => id !== userId) : [...currentIds, userId];

    if (newIds.length === 0) {
      toast.error('At least one member is required');
      return;
    }

    setSaving(rule.id);
    try {
      await updateRule(rule.id, { member_ids: newIds });
    } catch {
      toast.error('Failed to update members');
    } finally {
      setSaving(null);
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRule(deleteTarget);
      toast.success('Rule deleted');
    } catch {
      toast.error('Failed to delete rule');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleUpdateTagRoutes = async (rule: AutoAssignRule, tagRoutes: TagRoute[]) => {
    setSaving(rule.id);
    try {
      await updateRule(rule.id, { config: { ...rule.config, tag_routes: tagRoutes } });
    } catch {
      toast.error('Failed to update tag routes');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Build list: company-wide + each channel
  const entries: { channelId: number | null; label: string }[] = [
    { channelId: null, label: 'Company-Wide (Default)' },
    ...channels.map((ch) => ({ channelId: ch.id, label: formatChannelName(ch) })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure how new incoming conversations are automatically assigned to team members.
        Channel-specific rules take priority over the company-wide default.
      </p>

      {entries.map(({ channelId, label }) => {
        const rule = getRuleForChannel(channelId);
        return (
          <RuleCard
            key={channelId ?? 'default'}
            channelLabel={label}
            rule={rule}
            teamMembers={teamMembers}
            saving={saving}
            onCreateRule={() => handleCreateRule(channelId)}
            onUpdateStrategy={(strategy) => rule && handleUpdateStrategy(rule, strategy)}
            onToggleActive={() => rule && handleToggleActive(rule)}
            onToggleMember={(userId) => rule && handleToggleMember(rule, userId)}
            onDeleteRule={() => rule && setDeleteTarget(rule.id)}
            onUpdateTagRoutes={(routes) => rule && handleUpdateTagRoutes(rule, routes)}
          />
        );
      })}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete auto-assign rule?</AlertDialogTitle>
            <AlertDialogDescription>
              New conversations for this channel will no longer be automatically assigned.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- RuleCard ---

interface RuleCardProps {
  channelLabel: string;
  rule: AutoAssignRule | null;
  teamMembers: TeamMember[];
  saving: string | null;
  onCreateRule: () => void;
  onUpdateStrategy: (strategy: string) => void;
  onToggleActive: () => void;
  onToggleMember: (userId: string) => void;
  onDeleteRule: () => void;
  onUpdateTagRoutes: (routes: TagRoute[]) => void;
}

function RuleCard({
  channelLabel,
  rule,
  teamMembers,
  saving,
  onCreateRule,
  onUpdateStrategy,
  onToggleActive,
  onToggleMember,
  onDeleteRule,
  onUpdateTagRoutes,
}: RuleCardProps) {
  const isSaving = saving === rule?.id || saving === 'new';
  const memberIds = rule?.members.map((m) => m.user_id) || [];
  const tagRoutes: TagRoute[] = (rule?.config?.tag_routes as TagRoute[]) || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{channelLabel}</CardTitle>
        {rule && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={rule.is_active}
                onCheckedChange={onToggleActive}
                disabled={isSaving}
                className="data-[state=checked]:bg-green-500"
              />
              <span className="text-xs text-muted-foreground">
                {rule.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={onDeleteRule} disabled={isSaving}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!rule ? (
          <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
            <span className="text-sm text-muted-foreground">No auto-assign rule configured</span>
            <Button size="sm" variant="outline" onClick={onCreateRule} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add Rule
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Strategy picker */}
            <div className="space-y-1.5">
              <Label>Strategy</Label>
              <Select value={rule.strategy} onValueChange={onUpdateStrategy} disabled={isSaving}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <opt.icon className="h-4 w-4" />
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">- {opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Member pool */}
            <div className="space-y-1.5">
              <Label>Member Pool</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {teamMembers.map((member) => {
                  const isInPool = memberIds.includes(member.user_id);
                  return (
                    <div key={member.user_id} className="flex items-center gap-3">
                      <Checkbox
                        checked={isInPool}
                        onCheckedChange={() => onToggleMember(member.user_id)}
                        disabled={isSaving}
                      />
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {member.full_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{member.full_name}</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {member.role_name}
                      </Badge>
                    </div>
                  );
                })}
                {teamMembers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No team members found</p>
                )}
              </div>
            </div>

            {/* Tag-based config */}
            {rule.strategy === 'tag_based' && (
              <TagRoutesEditor
                tagRoutes={tagRoutes}
                teamMembers={teamMembers.filter((m) => memberIds.includes(m.user_id))}
                onChange={onUpdateTagRoutes}
                disabled={isSaving}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Tag Routes Editor ---

interface TagRoutesEditorProps {
  tagRoutes: TagRoute[];
  teamMembers: TeamMember[];
  onChange: (routes: TagRoute[]) => void;
  disabled: boolean;
}

function TagRoutesEditor({ tagRoutes, teamMembers, onChange, disabled }: TagRoutesEditorProps) {
  const [newTag, setNewTag] = useState('');
  const [newUserId, setNewUserId] = useState('');

  const handleAdd = () => {
    if (!newTag.trim() || !newUserId) return;
    const updated = [...tagRoutes, { tag: newTag.trim(), user_id: newUserId }];
    onChange(updated);
    setNewTag('');
    setNewUserId('');
  };

  const handleRemove = (index: number) => {
    const updated = tagRoutes.filter((_, i) => i !== index);
    onChange(updated);
  };

  const getMemberName = (userId: string) =>
    teamMembers.find((m) => m.user_id === userId)?.full_name || 'Unknown';

  return (
    <div className="space-y-1.5">
      <Label>Tag Routing</Label>
      <div className="space-y-2 rounded-lg border p-3">
        {tagRoutes.length > 0 && (
          <div className="space-y-2">
            {tagRoutes.map((route, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge variant="secondary">{route.tag}</Badge>
                <span className="text-sm text-muted-foreground">-&gt;</span>
                <span className="text-sm">{getMemberName(route.user_id)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6"
                  onClick={() => handleRemove(i)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Tag</Label>
            <Input
              placeholder="e.g. VIP"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              disabled={disabled}
              className="h-8"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Assign to</Label>
            <Select value={newUserId} onValueChange={setNewUserId} disabled={disabled}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={disabled || !newTag.trim() || !newUserId} className="h-8">
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {tagRoutes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No tag routes configured. Contacts without matching tags will be assigned via round-robin.
          </p>
        )}
      </div>
    </div>
  );
}
