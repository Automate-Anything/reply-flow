import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Conversation } from '@/hooks/useConversations';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}

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
}: ConversationItemProps) {
  const hasUnread = conversation.unread_count > 0;
  const name = conversation.contact_name || conversation.phone_number;
  const initial = (name[0] || '?').toUpperCase();

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors',
        'hover:bg-accent',
        isActive && 'bg-accent'
      )}
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {initial}
        </AvatarFallback>
      </Avatar>
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
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatTime(conversation.last_message_at)}
          </span>
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

        {conversation.labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
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
