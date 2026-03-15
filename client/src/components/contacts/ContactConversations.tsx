import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import type { Message } from '@/hooks/useMessages';
import ReadOnlyMessageList from './ReadOnlyMessageList';

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
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (!loading && messages.length > 0) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [loading, messages.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || loadingMore || !hasMore) return;
    // Load more when scrolled near the top
    if (el.scrollTop < 100 && messages.length > 0) {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col overflow-auto"
    >
      {loadingMore && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <ReadOnlyMessageList messages={messages} loading={false} contactName={contactName} />
    </div>
  );
}
