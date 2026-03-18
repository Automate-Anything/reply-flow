import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Plus, Pencil, Trash2, Globe, Target, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { AlertRuleDialog } from './AlertRuleDialog';
import type { AlertRule, GroupChat } from '@/types/groups';

interface AlertRulesListProps {
  rules: AlertRule[];
  groups: GroupChat[];
  loading: boolean;
  onCreateRule: (values: any) => Promise<void>;
  onUpdateRule: (rule: AlertRule, values: any) => Promise<void>;
  onDeleteRule: (rule: AlertRule) => Promise<void>;
  onToggleRule: (rule: AlertRule, enabled: boolean) => Promise<void>;
}

export function AlertRulesList({
  rules,
  groups,
  loading,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onToggleRule,
}: AlertRulesListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Define what to look for in your watched groups. When a message matches, the assigned team members get notified.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Target className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No alert rules yet</p>
            <p className="text-xs text-muted-foreground">
              Add a rule to get notified when group messages match your criteria.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            // Check if this rule has unwatched groups
            const watchedGroupIds = new Set(groups.filter((g) => g.monitoring_enabled).map((g) => g.id));
            const hasUnwatchedTargets = rule.scope !== null && rule.scope.some((id) => !watchedGroupIds.has(id));
            const allTargetsUnwatched = rule.scope !== null && rule.scope.every((id) => !watchedGroupIds.has(id));
            const noGroupsWatched = groups.every((g) => !g.monitoring_enabled);
            const showWarning = rule.scope === null ? noGroupsWatched : hasUnwatchedTargets;

            return (
            <Card key={rule.id} className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center justify-between py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{rule.name}</span>
                    <Badge variant="secondary">
                      {rule.match_type === 'keyword' ? 'Keyword' : 'AI'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      {rule.scope === null ? (
                        <>
                          <Globe className="h-3 w-3" />
                          All Groups
                        </>
                      ) : (
                        <>
                          <Target className="h-3 w-3" />
                          {rule.scope_names?.join(', ') || `${rule.scope.length} group${rule.scope.length > 1 ? 's' : ''}`}
                        </>
                      )}
                    </Badge>
                    {showWarning && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="flex items-center gap-1 border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              {rule.scope === null
                                ? 'No groups watched'
                                : allTargetsUnwatched
                                  ? 'Target groups not watched'
                                  : 'Some targets not watched'}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">
                              {rule.scope === null
                                ? 'None of your groups are being watched. This rule won\'t fire until you watch at least one group.'
                                : allTargetsUnwatched
                                  ? 'All groups this rule targets are not being watched. It won\'t fire until you start watching them.'
                                  : 'Some groups this rule targets are not being watched. The rule will only fire for watched groups.'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {rule.match_type === 'keyword'
                      ? `Keywords: ${rule.keyword_config.keywords?.join(', ') || 'none'} (${rule.keyword_config.operator?.toUpperCase()})`
                      : rule.ai_description || 'No description'}
                    {rule.notify_user_ids.length > 0 &&
                      ` · Notifies ${rule.notify_user_ids.length} member${rule.notify_user_ids.length > 1 ? 's' : ''}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <Switch
                    checked={rule.is_enabled}
                    onCheckedChange={(enabled) => onToggleRule(rule, enabled)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(rule);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <AlertRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        groups={groups}
        onSave={async (values) => {
          if (editing) {
            await onUpdateRule(editing, values);
          } else {
            await onCreateRule(values);
          }
          setDialogOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Alert Rule"
        description={`Are you sure you want to delete "${deleting?.name}"? This cannot be undone.`}
        actionLabel="Delete"
        onConfirm={async () => {
          if (deleting) {
            await onDeleteRule(deleting);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
