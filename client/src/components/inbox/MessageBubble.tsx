import { cn } from '@/lib/utils';
import { Clock, X } from 'lucide-react';
import type { Message } from '@/hooks/useMessages';

interface MessageBubbleProps {
  message: Message;
  onCancelScheduled?: (messageId: string) => Promise<void>;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatScheduledTime(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffMs <= 0) return 'Sending...';
  if (diffH < 1) return `in ${Math.ceil(diffMs / 60_000)}m`;
  if (diffH < 24) return `in ${diffH}h`;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function MessageBubble({ message, onCancelScheduled }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isScheduled = message.status === 'scheduled' && message.scheduled_for;

  return (
    <div
      className={cn(
        'flex w-full',
        isOutbound ? 'justify-end' : 'justify-start'
      )}
    >
      <div className={cn('max-w-[70%]', isScheduled && 'group')}>
        {isScheduled && (
          <div className="mb-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Scheduled {formatScheduledTime(message.scheduled_for!)}</span>
            {onCancelScheduled && (
              <button
                onClick={() => onCancelScheduled(message.id)}
                className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isScheduled
              ? 'border border-dashed border-primary/30 bg-primary/5 text-foreground'
              : isOutbound
                ? isAI
                  ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100'
                  : 'bg-primary/90 text-primary-foreground'
                : 'bg-muted text-foreground'
          )}
        >
          {isAI && (
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider opacity-70">
              AI
            </span>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.message_body}
          </p>
          {!isScheduled && (
            <div
              className={cn(
                'mt-1 flex items-center gap-1 text-[10px] opacity-60',
                isOutbound ? 'justify-end' : 'justify-start'
              )}
            >
              <span>{formatTimestamp(message.message_ts || message.created_at)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
