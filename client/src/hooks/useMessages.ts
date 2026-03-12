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
  media_storage_path: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
}

export function useMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setMessages([]);
    setLoading(true);
    try {
      const { data } = await api.get(`/conversations/${sessionId}/messages`);
      const msgs: Message[] = data.messages || [];
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const sendMessage = useCallback(
    async (body: string, quotedMessageId?: string, replyMetadata?: Record<string, unknown>) => {
      if (!sessionId) return;

      // Create optimistic message with pending status (shown immediately)
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const now = new Date().toISOString();
      const optimisticMsg: Message = {
        id: tempId,
        session_id: sessionId,
        message_body: body,
        message_type: 'text',
        direction: 'outbound',
        sender_type: 'human',
        status: 'pending',
        read: true,
        message_ts: now,
        scheduled_for: null,
        created_at: now,
        metadata: replyMetadata || null,
        is_starred: false,
        is_pinned: false,
        reactions: [],
        media_storage_path: null,
        media_mime_type: null,
        media_filename: null,
      };

      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const { data } = await api.post('/messages/send', { sessionId, body, quotedMessageId });
        // Replace temp message with real server message
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? data.message : m))
        );
        return data.message;
      } catch (err) {
        // Mark optimistic message as failed
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
        );
        throw err;
      }
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
