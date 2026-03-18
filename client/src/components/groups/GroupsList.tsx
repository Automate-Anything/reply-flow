import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Users } from 'lucide-react';
import type { GroupChat } from '@/types/groups';

interface GroupsListProps {
  groups: GroupChat[];
  loading: boolean;
  toggleMonitoring: (groupId: string, enabled: boolean) => void;
}

export function GroupsList({ groups, loading, toggleMonitoring }: GroupsListProps) {
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
      {groups.map((group) => (
        <Card key={group.id} className="transition-colors">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
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
