import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MessageSquare } from 'lucide-react';
import type { GroupChat, GroupCriteriaMatch, GroupCriteria } from '@/types/groups';

interface MatchedMessagesListProps {
  matches: GroupCriteriaMatch[];
  groups: GroupChat[];
  criteria: GroupCriteria[];
  loading: boolean;
  filterGroupId: string | null;
  filterCriteriaId: string | null;
  onFilterGroupChange: (id: string | null) => void;
  onFilterCriteriaChange: (id: string | null) => void;
}

export function MatchedMessagesList({
  matches,
  groups,
  criteria,
  loading,
  filterGroupId,
  filterCriteriaId,
  onFilterGroupChange,
  onFilterCriteriaChange,
}: MatchedMessagesListProps) {
  const groupMap = new Map(groups.map((g) => [g.id, g.group_name || g.group_jid]));
  const criteriaMap = new Map(criteria.map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={filterGroupId || '_all'}
          onValueChange={(v) => onFilterGroupChange(v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Groups</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.group_name || g.group_jid}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterCriteriaId || '_all'}
          onValueChange={(v) => onFilterCriteriaChange(v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Rules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Rules</SelectItem>
            {Array.from(new Map(criteria.map((c) => [c.name, c])).values()).map(
              (c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4 space-y-2">
                <Skeleton className="h-4 w-60" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No matched messages yet</p>
            <p className="text-xs text-muted-foreground">
              Matched messages will appear here when group messages trigger your alert rules.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {matches.map((match) => {
            const msg = match.group_chat_messages;
            if (!msg) return null;

            const groupName = groupMap.get(msg.group_chat_id) || msg.group_chat_id;
            const matchedRuleNames = (match.criteria_ids || [])
              .map((id) => criteriaMap.get(id))
              .filter(Boolean);

            return (
              <Card
                key={match.id}
                className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
              >
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {groupName}
                    </Badge>
                    <span className="font-medium text-sm">
                      {msg.sender_name || msg.sender_phone || 'Unknown'}
                    </span>
                    {msg.sender_phone && msg.sender_name && (
                      <span className="text-xs text-muted-foreground">
                        {msg.sender_phone}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(match.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm mb-2">{msg.message_body}</p>
                  {matchedRuleNames.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {matchedRuleNames.map((name, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
