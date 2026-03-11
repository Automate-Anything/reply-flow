import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ScheduledMessage {
  id: string;
  session_id: string;
  message_body: string | null;
  message_type: string;
  scheduled_for: string;
  created_at: string;
  session: {
    contact_name: string | null;
    phone_number: string;
  } | null;
}

export function useScheduledMessages(enabled = true) {
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScheduled = useCallback(async () => {
    if (!enabled) {
      setScheduledMessages([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/messages/scheduled');
      setScheduledMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to fetch scheduled messages:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setScheduledMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchScheduled();
  }, [enabled, fetchScheduled]);

  const updateMessage = useCallback(
    async (messageId: string, updates: { body?: string; scheduledFor?: string }) => {
      const { data } = await api.patch(`/messages/scheduled/${messageId}`, updates);
      setScheduledMessages((prev) =>
        prev.map((m) => (m.id === messageId ? data.message : m))
      );
      return data.message;
    },
    []
  );

  const cancelMessage = useCallback(
    async (messageId: string) => {
      await api.delete(`/messages/scheduled/${messageId}`);
      setScheduledMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    []
  );

  return { scheduledMessages, loading, refetch: fetchScheduled, updateMessage, cancelMessage };
}
