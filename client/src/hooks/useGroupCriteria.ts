import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupCriteria } from '@/types/groups';

export function useGroupCriteria(groupChatId?: string | null) {
  const [criteria, setCriteria] = useState<GroupCriteria[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCriteria = useCallback(async () => {
    try {
      const path = groupChatId
        ? `/groups/${groupChatId}/criteria`
        : '/groups/global-criteria';
      const { data } = await api.get(path);
      setCriteria(data.criteria || []);
    } catch (err) {
      console.error('Failed to fetch criteria:', err);
    } finally {
      setLoading(false);
    }
  }, [groupChatId]);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  const createCriteria = useCallback(
    async (values: Partial<GroupCriteria>) => {
      const { data } = await api.post('/groups/criteria', {
        ...values,
        group_chat_id: groupChatId || null,
      });
      setCriteria((prev) => [data, ...prev]);
      return data;
    },
    [groupChatId]
  );

  const updateCriteria = useCallback(async (id: string, values: Partial<GroupCriteria>) => {
    const { data } = await api.patch(`/groups/criteria/${id}`, values);
    setCriteria((prev) => prev.map((c) => (c.id === id ? data : c)));
    return data;
  }, []);

  const deleteCriteria = useCallback(async (id: string) => {
    await api.delete(`/groups/criteria/${id}`);
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { criteria, loading, refetch: fetchCriteria, createCriteria, updateCriteria, deleteCriteria };
}
