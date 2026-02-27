import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Clock, Star } from 'lucide-react';
import type { Conversation } from '@/hooks/useConversations';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
};

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * dayMs) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationItem({
  conversation,
  isActive,
  onClick,
  selectable,
  selected,
  onToggleSelect,
}: ConversationItemProps) {
  const hasUnread = conversation.unread_count > 0;
  const name = conversation.contact_name || conversation.phone_number;
  const initial = (name[0] || '?').toUpperCase();
  const priorityColor = PRIORITY_COLORS[conversation.priority];
  const statusLabel = STATUS_LABELS[conversation.status];
  const isSnoozed =
    conversation.snoozed_until && new Date(conversation.snoozed_until) > new Date();

  return (
    <button
      onClick={selectable ? onToggleSelect : onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors',
        'hover:bg-accent',
        isActive && 'bg-accent',
        selected && 'bg-primary/5'
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect?.()}
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div className="relative shrink-0">
        {priorityColor && (
          <span
            className={cn(
              'absolute -left-1 -top-1 z-10 h-2.5 w-2.5 rounded-full border-2 border-background',
              priorityColor
            )}
          />
        )}
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {initial}
          </AvatarFallback>
        </Avatar>
        {conversation.assigned_user && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-muted text-[8px] font-bold"
            title={`Assigned to ${conversation.assigned_user.full_name}`}
          >
            {(conversation.assigned_user.full_name[0] || '?').toUpperCase()}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              hasUnread ? 'font-semibold' : 'font-medium'
            )}
          >
            {name}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {conversation.is_starred && (
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            )}
            {isSnoozed && (
              <Clock className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-[11px] text-muted-foreground">
              {formatTime(conversation.last_message_at)}
            </span>
          </div>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-xs',
              hasUnread ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            {conversation.last_message_direction === 'outbound' && (
              <span className="font-normal text-muted-foreground">You: </span>
            )}
            {conversation.last_message || 'No messages yet'}
          </span>
          {hasUnread && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {conversation.unread_count}
            </span>
          )}
        </div>

        {(conversation.labels.length > 0 || statusLabel) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {statusLabel && (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10px]"
              >
                {statusLabel}
              </Badge>
            )}
            {conversation.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                className="h-4 px-1.5 text-[10px]"
                style={{ borderColor: label.color, color: label.color }}
              >
                {label.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
