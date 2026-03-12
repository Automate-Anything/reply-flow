import { useEffect, useRef, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import MessageContextMenu from './MessageContextMenu';
import MessageInput from './MessageInput';
import type { Message } from '@/hooks/useMessages';

interface MessageThreadProps {
  messages: Message[];
  loading: boolean;
  sessionId: string;
  contactName?: string;
  contactAvatarUrl?: string | null;
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

const SCROLL_STORAGE_KEY = 'reply-flow-scroll-positions';
const NEAR_BOTTOM_THRESHOLD = 150;

function getScrollPositions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveScrollPosition(sessionId: string, scrollTop: number) {
  const positions = getScrollPositions();
  positions[sessionId] = scrollTop;
  sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
}

export default function MessageThread({
  messages,
  loading,
  sessionId,
  contactName,
  contactAvatarUrl,
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevSessionRef = useRef<string | null>(null);
  const hasRestoredScroll = useRef(false);
  const prevMessageCountRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, []);

  // Track scroll position for persistence + show/hide scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowScrollDown(!isNearBottom());
    saveScrollPosition(sessionId, el.scrollTop);
  }, [sessionId, isNearBottom]);

  // Detect when switching to a new conversation
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      hasRestoredScroll.current = false;
      prevMessageCountRef.current = 0;
      setShowScrollDown(false);
      // The messages effect will handle scroll: restore saved position or scroll to bottom
    }
  }, [sessionId]);

  // Handle scroll on message changes: restore position, stick to bottom, or leave alone
  useEffect(() => {
    if (loading || messages.length === 0) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    // First load for this session — restore saved position or scroll to bottom
    if (!hasRestoredScroll.current) {
      hasRestoredScroll.current = true;
      const positions = getScrollPositions();
      const savedScroll = positions[sessionId];
      if (savedScroll !== undefined && savedScroll > 0) {
        // Restore saved scroll position (e.g., after refresh or page navigation)
        el.scrollTop = savedScroll;
      } else {
        // No saved position — scroll to bottom
        bottomRef.current?.scrollIntoView();
      }
      prevMessageCountRef.current = messages.length;
      return;
    }

    // New messages arrived — scroll to bottom only if user was already near bottom
    if (messages.length > prevMessageCountRef.current) {
      if (isNearBottom()) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }

    prevMessageCountRef.current = messages.length;
  }, [messages, loading, sessionId, isNearBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-component="MessageThread">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-4 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-400/50 [&::-webkit-scrollbar-track]:bg-transparent"
        >
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
                    contactAvatarUrl={contactAvatarUrl}
                    onCancelScheduled={msg.status === 'scheduled' ? onCancelScheduled : undefined}
                    onReply={onReply}
                    onMessageUpdate={onMessageUpdate}
                    isDebugMode={isDebugMode}
                  />
                </MessageContextMenu>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border bg-background shadow-lg transition-colors hover:bg-accent"
            title="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      <MessageInput
        key={sessionId}
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
