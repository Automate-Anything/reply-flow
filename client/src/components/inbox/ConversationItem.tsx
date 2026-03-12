import { cn } from '@/lib/utils';
import { formatRelativeDate, formatSnoozeUntil } from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Camera, Clock, FileText, Mic, Pin, Play, RotateCcw, Star } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import type { Conversation } from '@/hooks/useConversations';
import type { ConversationPriority } from '@/hooks/useConversationPriorities';

interface ConversationItemProps {
  conversation: Conversation;
  priorities?: ConversationPriority[];
  isActive: boolean;
  onClick: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

const FALLBACK_PRIORITY_COLORS: Record<string, string> = {
  Urgent: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
};

// Show badge for any status except the default "open"
function getStatusLabel(status: string): string | null {
  if (status === 'open') return null;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const MEDIA_PATTERNS: { pattern: RegExp; icon: typeof Mic; getLabel: (text: string) => string }[] = [
  { pattern: /^\[Voice message( \d+:\d{2})?\]$/i, icon: Mic, getLabel: (t) => {
    const m = t.match(/(\d+:\d{2})/);
    return m ? m[1] : 'Voice message';
  }},
  { pattern: /^\[Audio message( \d+:\d{2})?\]$/i, icon: Mic, getLabel: (t) => {
    const m = t.match(/(\d+:\d{2})/);
    return m ? m[1] : 'Audio message';
  }},
  { pattern: /^\[Image\]$/i, icon: Camera, getLabel: () => 'Photo' },
  { pattern: /^\[Video\]$/i, icon: Play, getLabel: () => 'Video' },
  { pattern: /^\[Document: .+\]$/i, icon: FileText, getLabel: (t) => t.replace(/^\[Document: (.+)\]$/, '$1') },
];

function formatLastMessage(text: string) {
  const trimmed = text.trim();
  for (const { pattern, icon: Icon, getLabel } of MEDIA_PATTERNS) {
    if (pattern.test(trimmed)) {
      return (
        <span className="inline-flex items-center gap-1">
          <Icon className="h-3 w-3" />
          {getLabel(trimmed)}
        </span>
      );
    }
  }
  return text;
}


export default function ConversationItem({
  conversation,
  priorities = [],
  isActive,
  onClick,
  selectable,
  selected,
  onToggleSelect,
}: ConversationItemProps) {
  const { companyTimezone: tz } = useSession();
  const hasUnread = conversation.unread_count > 0 || conversation.marked_unread;
  const name = conversation.contact_name || conversation.phone_number;
  const initial = (name[0] || '?').toUpperCase();
  const priorityColor =
    priorities.find((priority) => priority.name === conversation.priority)?.color ||
    FALLBACK_PRIORITY_COLORS[conversation.priority];
  const statusLabel = getStatusLabel(conversation.status);
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
            className="absolute -left-1 -top-1 z-10 h-2.5 w-2.5 rounded-full border-2 border-background"
            style={{ backgroundColor: priorityColor }}
          />
        )}
        <Avatar className="h-10 w-10">
          {conversation.profile_picture_url && (
            <AvatarImage src={conversation.profile_picture_url} alt={name} />
          )}
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
            {conversation.pinned_at && (
              <Pin className="h-3 w-3 text-muted-foreground" />
            )}
            {conversation.is_starred && (
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            )}
            {isSnoozed && (
              <Clock className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-[11px] text-muted-foreground">
              {formatRelativeDate(conversation.last_message_at, tz)}
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
            {conversation.draft_message ? (
              <>
                <span className="font-medium text-orange-500">Draft: </span>
                {conversation.draft_message}
              </>
            ) : (
              <>
                {conversation.last_message_direction === 'outbound' && (
                  <span className="font-normal text-muted-foreground">You: </span>
                )}
                {conversation.last_message ? formatLastMessage(conversation.last_message) : 'No messages yet'}
              </>
            )}
          </span>
          {hasUnread && (
            conversation.unread_count > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
            )
          )}
        </div>

        {(conversation.labels.length > 0 || statusLabel || isSnoozed || conversation.contact_session_count > 1) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {conversation.contact_session_count > 1 && (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10px] gap-0.5 text-violet-600 dark:text-violet-400"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                {conversation.contact_session_count === 2
                  ? '2nd'
                  : conversation.contact_session_count === 3
                    ? '3rd'
                    : `${conversation.contact_session_count}th`}
              </Badge>
            )}
            {isSnoozed && (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10px] gap-0.5"
              >
                <Clock className="h-2.5 w-2.5" />
                {formatSnoozeUntil(conversation.snoozed_until!, tz)}
              </Badge>
            )}
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
