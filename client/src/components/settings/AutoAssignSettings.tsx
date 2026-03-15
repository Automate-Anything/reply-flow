import { useState, useEffect, useCallback } from 'react';
import { Shuffle, Users, Tag, Plus, Trash2, Loader2, ChevronRight, Phone } from 'lucide-react';
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

type AutoAssignMode = 'company' | 'per_channel';

export default function AutoAssignSettings() {
  const { rules, loading: rulesLoading, createRule, updateRule, deleteRule } = useAutoAssignRules();
  const { members: teamMembers, loading: membersLoading } = useTeamMembers();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [mode, setMode] = useState<AutoAssignMode>('company');
  const [modeLoading, setModeLoading] = useState(true);
  const [modeSaving, setModeSaving] = useState(false);

  // Fetch channels + mode
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
    (async () => {
      try {
        const { data } = await api.get('/company');
        setMode(data.company.auto_assign_mode || 'company');
      } catch {
        // ignore
      } finally {
        setModeLoading(false);
      }
    })();
  }, []);

  const handleModeChange = async (newMode: AutoAssignMode) => {
    setModeSaving(true);
    try {
      await api.put('/company', { auto_assign_mode: newMode });
      setMode(newMode);
      toast.success(newMode === 'company' ? 'Switched to company-wide auto-assign' : 'Switched to per-channel auto-assign');
    } catch {
      toast.error('Failed to update mode');
    } finally {
      setModeSaving(false);
    }
  };

  const loading = rulesLoading || membersLoading || channelsLoading || modeLoading;

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

  const companyRule = getRuleForChannel(null);

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 rounded-lg border p-1">
        <button
          type="button"
          onClick={() => mode !== 'company' && handleModeChange('company')}
          disabled={modeSaving}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === 'company'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          Company-Wide
        </button>
        <button
          type="button"
          onClick={() => mode !== 'per_channel' && handleModeChange('per_channel')}
          disabled={modeSaving}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === 'per_channel'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          Per Channel
        </button>
      </div>

      {mode === 'company' ? (
        <div>
          <p className="text-xs text-muted-foreground mb-3">
            One rule applies to all channels. Every incoming conversation is assigned using the same strategy and member pool.
          </p>
          <RuleCard
            channelLabel="All Channels"
            rule={companyRule}
            teamMembers={teamMembers}
            saving={saving}
            onCreateRule={() => handleCreateRule(null)}
            onUpdateStrategy={(strategy) => companyRule && handleUpdateStrategy(companyRule, strategy)}
            onToggleActive={() => companyRule && handleToggleActive(companyRule)}
            onToggleMember={(userId) => companyRule && handleToggleMember(companyRule, userId)}
            onDeleteRule={() => companyRule && setDeleteTarget(companyRule.id)}
            onUpdateTagRoutes={(routes) => companyRule && handleUpdateTagRoutes(companyRule, routes)}
          />
        </div>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground mb-3">
            Each channel has its own auto-assign rule. Channels without a rule will not auto-assign conversations.
          </p>
          {channels.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No channels connected yet.
            </div>
          ) : (
            <div className="space-y-1">
              {channels.map((ch) => {
                const rule = getRuleForChannel(ch.id);
                return (
                  <ChannelRuleRow
                    key={ch.id}
                    channelLabel={formatChannelName(ch)}
                    rule={rule}
                    teamMembers={teamMembers}
                    saving={saving}
                    onCreateRule={() => handleCreateRule(ch.id)}
                    onUpdateStrategy={(strategy) => rule && handleUpdateStrategy(rule, strategy)}
                    onToggleActive={() => rule && handleToggleActive(rule)}
                    onToggleMember={(userId) => rule && handleToggleMember(rule, userId)}
                    onDeleteRule={() => rule && setDeleteTarget(rule.id)}
                    onUpdateTagRoutes={(routes) => rule && handleUpdateTagRoutes(rule, routes)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

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

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{channelLabel}</span>
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
                {rule.is_active ? 'Auto-assigning' : 'Paused'}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={onDeleteRule} disabled={isSaving}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      <RuleContent
        rule={rule}
        teamMembers={teamMembers}
        isSaving={isSaving}
        onCreateRule={onCreateRule}
        onUpdateStrategy={onUpdateStrategy}
        onToggleMember={onToggleMember}
        onUpdateTagRoutes={onUpdateTagRoutes}
      />
    </div>
  );
}

// --- Collapsible channel row ---

function ChannelRuleRow(props: RuleCardProps) {
  const [open, setOpen] = useState(false);
  const { channelLabel, rule, teamMembers, saving, onCreateRule, onUpdateStrategy, onToggleActive, onToggleMember, onDeleteRule, onUpdateTagRoutes } = props;
  const isSaving = saving === rule?.id || saving === 'new';

  const strategyLabel = rule
    ? STRATEGY_OPTIONS.find((o) => o.value === rule.strategy)?.label || rule.strategy
    : null;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium flex-1">{channelLabel}</span>
        {rule ? (
          <div className="flex items-center gap-2">
            <Badge variant={rule.is_active ? 'default' : 'secondary'} className="text-[10px]">
              {rule.is_active ? strategyLabel : 'Inactive'}
            </Badge>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Using default</span>
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-3">
          {rule && (
            <div className="flex items-center justify-end gap-3">
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
          <RuleContent
            rule={rule}
            teamMembers={teamMembers}
            isSaving={isSaving}
            onCreateRule={onCreateRule}
            onUpdateStrategy={onUpdateStrategy}
            onToggleMember={onToggleMember}
            onUpdateTagRoutes={onUpdateTagRoutes}
          />
        </div>
      )}
    </div>
  );
}

// --- Shared rule content (strategy + members + tags) ---

function RuleContent({
  rule,
  teamMembers,
  isSaving,
  onCreateRule,
  onUpdateStrategy,
  onToggleMember,
  onUpdateTagRoutes,
}: {
  rule: AutoAssignRule | null;
  teamMembers: TeamMember[];
  isSaving: boolean;
  onCreateRule: () => void;
  onUpdateStrategy: (strategy: string) => void;
  onToggleMember: (userId: string) => void;
  onUpdateTagRoutes: (routes: TagRoute[]) => void;
}) {
  const memberIds = rule?.members.map((m) => m.user_id) || [];
  const tagRoutes: TagRoute[] = (rule?.config?.tag_routes as TagRoute[]) || [];

  if (!rule) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
        <span className="text-sm text-muted-foreground">No rule configured — using default</span>
        <Button size="sm" variant="outline" onClick={onCreateRule} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add Override
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {rule.strategy === 'tag_based' && (
        <TagRoutesEditor
          tagRoutes={tagRoutes}
          teamMembers={teamMembers.filter((m) => memberIds.includes(m.user_id))}
          onChange={onUpdateTagRoutes}
          disabled={isSaving}
        />
      )}
    </div>
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
