import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDown, Loader2, MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import type { Message } from '@/hooks/useMessages';
import MessageBubble from '@/components/inbox/MessageBubble';

export interface ContactSession {
  id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  channel_id: number | null;
  channel_name: string | null;
  message_count: number;
  memory_count: number;
}

interface ContactConversationsProps {
  contactId: string;
  sessions: ContactSession[];
  sessionsLoading: boolean;
  contactName?: string;
}

const PAGE_SIZE = 50;

export default function ContactConversations({
  contactId,
  sessions: _sessions,
  sessionsLoading: _sessionsLoading,
  contactName,
}: ContactConversationsProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async (before?: string) => {
    const isInitial = !before;
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) };
      if (before) params.before = before;
      const { data } = await api.get(`/contacts/${contactId}/messages`, { params });
      const fetched: Message[] = data.messages || [];

      if (fetched.length < PAGE_SIZE) setHasMore(false);

      if (isInitial) {
        setMessages(fetched);
      } else {
        // Prepend older messages
        setMessages((prev) => [...fetched, ...prev]);
      }
    } catch {
      // Silently fail
    } finally {
      if (isInitial) setLoading(false);
      else setLoadingMore(false);
    }
  }, [contactId]);

  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    fetchMessages();
  }, [fetchMessages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading && messages.length > 0 && !loadingMore) {
      bottomRef.current?.scrollIntoView();
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Show/hide scroll-to-bottom button
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 150);

    // Load more when scrolled near the top
    if (el.scrollTop < 100 && !loadingMore && hasMore && messages.length > 0) {
      const oldestTs = messages[0]?.created_at;
      if (oldestTs) {
        const prevHeight = el.scrollHeight;
        fetchMessages(oldestTs).then(() => {
          // Preserve scroll position after prepending
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight;
          });
        });
      }
    }
  }, [loadingMore, hasMore, messages, fetchMessages]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <Skeleton className="h-12 w-48 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="py-8 text-center">
        <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No messages yet</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto p-4 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-400/50 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="space-y-2">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              messages={messages}
              contactName={contactName}
            />
          ))}
          <div ref={bottomRef} />
        </div>
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
  );
}
