import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { GroupChat } from '@/types/groups';

interface GroupsListProps {
  onSelectGroup: (groupId: string) => void;
  groups: GroupChat[];
  loading: boolean;
  toggleMonitoring: (groupId: string, enabled: boolean) => void;
}

export function GroupsList({ onSelectGroup, groups, loading, toggleMonitoring }: GroupsListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No groups discovered yet</p>
        <p className="text-sm mt-1">
          Groups will appear here automatically when messages are received from WhatsApp group chats.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <GroupRow
          key={group.id}
          group={group}
          onSelect={() => onSelectGroup(group.id)}
          onToggleMonitoring={(enabled) => toggleMonitoring(group.id, enabled)}
        />
      ))}
    </div>
  );
}

function GroupRow({
  group,
  onSelect,
  onToggleMonitoring,
}: {
  group: GroupChat;
  onSelect: () => void;
  onToggleMonitoring: (enabled: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {group.group_name || group.group_jid}
          </span>
          {group.criteria_count && group.criteria_count > 0 ? (
            <Badge variant="secondary">{group.criteria_count} criteria</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground truncate mt-0.5">
          {group.group_jid}
        </p>
      </div>

      <div
        className="flex items-center gap-2 ml-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          {group.monitoring_enabled ? 'Monitoring' : 'Off'}
        </span>
        <Switch
          checked={group.monitoring_enabled}
          onCheckedChange={onToggleMonitoring}
        />
      </div>
    </div>
  );
}
