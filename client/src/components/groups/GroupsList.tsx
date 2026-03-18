import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Users, Eye, EyeOff, X, Loader2 } from 'lucide-react';
import type { GroupChat } from '@/types/groups';

interface GroupsListProps {
  groups: GroupChat[];
  loading: boolean;
  toggleMonitoring: (groupId: string, enabled: boolean) => void;
  bulkToggleMonitoring: (groupIds: string[], enabled: boolean) => Promise<void>;
}

export function GroupsList({ groups, loading, toggleMonitoring, bulkToggleMonitoring }: GroupsListProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActioning, setBulkActioning] = useState(false);

  const allSelected = groups.length > 0 && selectedIds.length === groups.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < groups.length;

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? groups.map((g) => g.id) : []);
  }, [groups]);

  const handleSelectOne = useCallback((groupId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, groupId] : prev.filter((id) => id !== groupId)
    );
  }, []);

  const handleBulkToggle = useCallback(async (enabled: boolean) => {
    setBulkActioning(true);
    try {
      await bulkToggleMonitoring(selectedIds, enabled);
      setSelectedIds([]);
    } finally {
      setBulkActioning(false);
    }
  }, [selectedIds, bulkToggleMonitoring]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No groups found</p>
          <p className="text-xs text-muted-foreground">
            Click "Sync Groups" to discover groups from your WhatsApp channels.
          </p>
        </CardContent>
      </Card>
    );
  }

  const monitoredCount = groups.filter((g) => g.monitoring_enabled).length;

  return (
    <div className="space-y-2">
      {/* Header + bulk actions */}
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => handleSelectAll(checked === true)}
          />
          <span className="text-sm font-medium text-muted-foreground">
            {selectedIds.length > 0
              ? `${selectedIds.length} of ${groups.length} selected`
              : `${groups.length} groups`}
          </span>
        </label>

        <span className="text-xs text-muted-foreground">
          {monitoredCount} watching · {groups.length - monitoredCount} not watching
        </span>
      </div>

      {/* Bulk action bar — visible when groups are selected */}
      {selectedIds.length > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-medium">
            {selectedIds.length} group{selectedIds.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="gap-1.5"
              disabled={bulkActioning}
              onClick={() => handleBulkToggle(true)}
            >
              {bulkActioning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Watch {selectedIds.length === 1 ? 'Group' : `All ${selectedIds.length} Groups`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={bulkActioning}
              onClick={() => handleBulkToggle(false)}
            >
              <EyeOff className="h-4 w-4" />
              Unwatch {selectedIds.length === 1 ? 'Group' : `All ${selectedIds.length} Groups`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkActioning}
              onClick={() => setSelectedIds([])}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

        </div>
      </div>

      {/* Group rows */}
      {groups.map((group) => {
        const isSelected = selectedIds.includes(group.id);
        return (
          <Card
            key={group.id}
            className={`transition-colors cursor-pointer ${isSelected ? 'ring-1 ring-primary/30 bg-primary/[0.02]' : ''}`}
            onClick={() => handleSelectOne(group.id, !isSelected)}
          >
            <CardContent className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => handleSelectOne(group.id, checked === true)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {group.group_name || group.group_jid}
                    </span>
                    {(group.criteria_count ?? 0) > 0 && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {group.criteria_count} rule{group.criteria_count !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {group.channel_name ? `${group.channel_name} · ` : ''}
                    {group.group_jid}
                  </p>
                </div>
              </div>

              <div
                className="flex items-center gap-2 ml-4 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Badge
                  variant={group.monitoring_enabled ? 'default' : 'outline'}
                  className={`text-xs ${group.monitoring_enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 hover:bg-emerald-100' : ''}`}
                >
                  {group.monitoring_enabled ? 'Watching' : 'Not watching'}
                </Badge>
                <Switch
                  checked={group.monitoring_enabled}
                  onCheckedChange={(enabled) => toggleMonitoring(group.id, enabled)}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
