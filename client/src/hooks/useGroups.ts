import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupChat } from '@/types/groups';

export function useGroups() {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await api.get('/groups');
      setGroups(data.groups || []);
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const toggleMonitoring = useCallback(async (groupId: string, enabled: boolean) => {
    await api.patch(`/groups/${groupId}`, { monitoring_enabled: enabled });
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, monitoring_enabled: enabled } : g))
    );
  }, []);

  return { groups, loading, refetch: fetchGroups, toggleMonitoring };
}
