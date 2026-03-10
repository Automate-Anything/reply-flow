import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface Message {
  id: string;
  session_id: string;
  message_body: string | null;
  message_type: string;
  direction: string;
  sender_type: 'ai' | 'human' | 'contact';
  status: string;
  read: boolean;
  message_ts: string | null;
  scheduled_for: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  is_starred: boolean;
  is_pinned: boolean;
  reactions: Array<{ emoji: string; user_id: string }>;
}

export function useMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/conversations/${sessionId}/messages`);
      const msgs: Message[] = data.messages || [];
      const seen = new Set<string>();
      const deduped = msgs.filter((m) => {
        if (seen.has(m.id)) {
          console.warn('[useMessages] duplicate message id in fetch response:', m.id);
          return false;
        }
        seen.add(m.id);
        return true;
      });
      console.log('[useMessages] fetch complete, setting', deduped.length, 'messages for sessionId:', sessionId);
      setMessages(deduped);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    console.log('[useMessages] effect running for sessionId:', sessionId);
    fetchMessages();
  }, [fetchMessages]);

  const sendMessage = useCallback(
    async (body: string, quotedMessageId?: string) => {
      if (!sessionId) return;
      const { data } = await api.post('/messages/send', { sessionId, body, quotedMessageId });
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      return data.message;
    },
    [sessionId]
  );

  const scheduleMessage = useCallback(
    async (body: string, scheduledFor: string) => {
      if (!sessionId) return;
      const { data } = await api.post('/messages/schedule', { sessionId, body, scheduledFor });
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      return data.message;
    },
    [sessionId]
  );

  const cancelScheduledMessage = useCallback(
    async (messageId: string) => {
      await api.delete(`/messages/scheduled/${messageId}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    []
  );

  const markRead = useCallback(async () => {
    if (!sessionId) return;
    await api.post(`/conversations/${sessionId}/read`);
  }, [sessionId]);

  return { messages, setMessages, loading, sendMessage, scheduleMessage, cancelScheduledMessage, markRead, refetch: fetchMessages };
}
