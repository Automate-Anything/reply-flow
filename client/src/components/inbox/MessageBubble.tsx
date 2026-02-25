import { cn } from '@/lib/utils';
import type { Message } from '@/hooks/useMessages';

interface MessageBubbleProps {
  message: Message;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';

  return (
    <div
      className={cn(
        'flex w-full',
        isOutbound ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-4 py-2',
          isOutbound
            ? isAI
              ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100'
              : 'bg-primary text-primary-foreground'
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
        <div
          className={cn(
            'mt-1 flex items-center gap-1 text-[10px] opacity-60',
            isOutbound ? 'justify-end' : 'justify-start'
          )}
        >
          <span>{formatTimestamp(message.message_ts || message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
