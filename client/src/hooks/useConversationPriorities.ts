import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

export interface ConversationPriority {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

export function useConversationPriorities(enabled = true) {
  const [priorities, setPriorities] = useState<ConversationPriority[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPriorities = useCallback(async () => {
    if (!enabled) {
      setPriorities([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/conversation-priorities');
      setPriorities(data.priorities || []);
    } catch (err) {
      console.error('Failed to fetch conversation priorities:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    setLoading(true);
    fetchPriorities();
  }, [fetchPriorities]);

  const create = useCallback(async (payload: { name: string; color: string }) => {
    const { data } = await api.post('/conversation-priorities', payload);
    setPriorities((prev) => [...prev, data.priority].sort((a, b) => a.sort_order - b.sort_order));
    return data.priority;
  }, []);

  const update = useCallback(async (id: string, payload: { name?: string; color?: string }) => {
    const { data } = await api.put(`/conversation-priorities/${id}`, payload);
    setPriorities((prev) => prev.map((priority) => (priority.id === id ? data.priority : priority)));
    return data.priority;
  }, []);

  const reorder = useCallback(async (payload: Array<{ id: string; sort_order: number }>) => {
    await api.put('/conversation-priorities/reorder', { priorities: payload });
    setPriorities((prev) => {
      const next = [...prev];
      for (const item of payload) {
        const match = next.find((priority) => priority.id === item.id);
        if (match) match.sort_order = item.sort_order;
      }
      return next.sort((a, b) => a.sort_order - b.sort_order);
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.delete(`/conversation-priorities/${id}`);
    setPriorities((prev) => prev.filter((priority) => priority.id !== id));
  }, []);

  return { priorities, loading, create, update, reorder, remove, refetch: fetchPriorities };
}
