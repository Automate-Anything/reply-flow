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
  created_at: string;
  metadata: Record<string, unknown> | null;
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
      setMessages(data.messages || []);
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
    async (body: string) => {
      if (!sessionId) return;
      const { data } = await api.post('/messages/send', { sessionId, body });
      setMessages((prev) => [...prev, data.message]);
      return data.message;
    },
    [sessionId]
  );

  const markRead = useCallback(async () => {
    if (!sessionId) return;
    await api.post(`/conversations/${sessionId}/read`);
  }, [sessionId]);

  return { messages, setMessages, loading, sendMessage, markRead, refetch: fetchMessages };
}
