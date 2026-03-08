import { cn } from '@/lib/utils';
import { Clock, Pin, Reply, Star, X } from 'lucide-react';
import type { Message } from '@/hooks/useMessages';
import AIDebugPanel from './AIDebugPanel';
import type { AIDebugData } from './AIDebugPanel';

interface ReplyMetadata {
  quoted_message_id: string | null;
  quoted_content: string | null;
  quoted_sender: string | null;
  quoted_type: string | null;
}

interface MessageBubbleProps {
  message: Message;
  onCancelScheduled?: (messageId: string) => Promise<void>;
  onReply?: (message: Message) => void;
  isDebugMode?: boolean;
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

function groupReactions(reactions: Array<{ emoji: string; user_id: string }>): Array<{ emoji: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of reactions) {
    map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
  }
  return Array.from(map, ([emoji, count]) => ({ emoji, count }));
}

export default function MessageBubble({ message, onCancelScheduled, onReply, isDebugMode }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isScheduled = message.status === 'scheduled' && message.scheduled_for;
  const reply = (message.metadata?.reply as ReplyMetadata) || null;
  const reactions = groupReactions(message.reactions || []);
  const debugData = isDebugMode && isAI ? (message.metadata?.debug as AIDebugData | undefined) : undefined;

  return (
    <div
      data-component="MessageBubble"
      className={cn(
        'group/msg flex w-full items-center gap-1',
        isOutbound ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Reply button — outbound messages: appears to the left */}
      {isOutbound && onReply && !isScheduled && (
        <button
          onClick={() => onReply(message)}
          className="shrink-0 rounded-full p-1 opacity-0 transition-opacity hover:bg-muted group-hover/msg:opacity-100"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

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

        {/* Quoted message preview */}
        {reply && (
          <div
            className={cn(
              'mb-1 rounded-lg border-l-2 border-primary/50 bg-muted/50 px-3 py-1.5 text-xs',
              isOutbound && 'ml-auto'
            )}
          >
            <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
              {reply.quoted_sender === 'contact' ? 'Contact' : 'You'}
            </p>
            <p className="line-clamp-2 text-muted-foreground">
              {reply.quoted_content || '[Media message]'}
            </p>
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
              {message.is_pinned && <Pin className="h-2.5 w-2.5" />}
              {message.is_starred && <Star className="h-2.5 w-2.5 fill-current" />}
              <span>{formatTimestamp(message.message_ts || message.created_at)}</span>
            </div>
          )}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className={cn('mt-1 flex gap-0.5', isOutbound ? 'justify-end' : 'justify-start')}>
            {reactions.map(({ emoji, count }) => (
              <span
                key={emoji}
                className="rounded-full border bg-background px-1.5 py-0.5 text-xs shadow-sm"
              >
                {emoji}{count > 1 ? ` ${count}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* AI Debug Panel */}
        {debugData && <AIDebugPanel debugData={debugData} />}
      </div>

      {/* Reply button — inbound messages: appears to the right */}
      {!isOutbound && onReply && !isScheduled && (
        <button
          onClick={() => onReply(message)}
          className="shrink-0 rounded-full p-1 opacity-0 transition-opacity hover:bg-muted group-hover/msg:opacity-100"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
