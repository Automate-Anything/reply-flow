import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
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

  return (
    <div className="space-y-2">
      {/* Header row with Select All */}
      <div className="flex items-center gap-3 px-4 py-2">
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={(checked) => handleSelectAll(checked === true)}
        />
        <span className="text-sm text-muted-foreground">
          {groups.length} group{groups.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="bg-muted/50 border rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={bulkActioning}
              onClick={() => handleBulkToggle(true)}
            >
              Enable Monitoring
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkActioning}
              onClick={() => handleBulkToggle(false)}
            >
              Disable Monitoring
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkActioning}
              onClick={() => setSelectedIds([])}
            >
              Deselect
            </Button>
          </div>
        </div>
      )}

      {/* Group rows */}
      {groups.map((group) => (
        <Card key={group.id} className="transition-colors">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Checkbox
                checked={selectedIds.includes(group.id)}
                onCheckedChange={(checked) => handleSelectOne(group.id, checked === true)}
              />
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {group.group_name || group.group_jid}
                  </span>
                  {(group.criteria_count ?? 0) > 0 && (
                    <Badge variant="secondary" className="shrink-0">
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

            <div className="flex items-center gap-2 ml-4 shrink-0">
              <span className="text-xs text-muted-foreground">
                {group.monitoring_enabled ? 'Monitoring' : 'Off'}
              </span>
              <Switch
                checked={group.monitoring_enabled}
                onCheckedChange={(enabled) => toggleMonitoring(group.id, enabled)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
