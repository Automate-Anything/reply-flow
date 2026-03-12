import { useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import MessageBubble from './MessageBubble';
import MessageContextMenu from './MessageContextMenu';
import MessageInput from './MessageInput';
import type { Message } from '@/hooks/useMessages';

interface MessageThreadProps {
  messages: Message[];
  loading: boolean;
  sessionId: string;
  contactName?: string;
  onSend: (body: string) => Promise<void>;
  onSchedule: (body: string, scheduledFor: string) => Promise<void>;
  onCancelScheduled: (messageId: string) => Promise<void>;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  replyingTo?: Message | null;
  onReply?: (message: Message) => void;
  onCancelReply?: () => void;
  onMessageUpdate: (message: Message) => void;
  onForward: (message: Message) => void;
  isDebugMode?: boolean;
}

export default function MessageThread({
  messages,
  loading,
  sessionId,
  contactName,
  onSend,
  onSchedule,
  onCancelScheduled,
  initialDraft,
  onDraftChange,
  replyingTo,
  onReply,
  onCancelReply,
  onMessageUpdate,
  onForward,
  isDebugMode,
}: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-component="MessageThread">
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
              >
                <Skeleton className="h-12 w-48 rounded-2xl" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Send a message to start the conversation.
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => (
              <MessageContextMenu
                key={msg.id}
                message={msg}
                sessionId={sessionId}
                onReply={onReply || (() => {})}
                onMessageUpdate={onMessageUpdate}
                onForward={onForward}
              >
                <MessageBubble
                  message={msg}
                  messages={messages}
                  contactName={contactName}
                  onCancelScheduled={msg.status === 'scheduled' ? onCancelScheduled : undefined}
                  onReply={onReply}
                  isDebugMode={isDebugMode}
                />
              </MessageContextMenu>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageInput
        onSend={onSend}
        onSchedule={onSchedule}
        initialDraft={initialDraft}
        onDraftChange={onDraftChange}
        replyingTo={replyingTo}
        onCancelReply={onCancelReply}
      />
    </div>
  );
}
