import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { GroupChat } from '@/types/groups';

export function useGroups() {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const hasAutoSynced = useRef(false);

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

  const syncGroups = useCallback(async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/groups/sync');
      setGroups(data.groups || []);
      if (data.new_count > 0) {
        toast.success(`Synced — ${data.new_count} new group${data.new_count > 1 ? 's' : ''} found`);
      } else {
        toast.success('All groups up to date');
      }
      if (data.errors?.length > 0) {
        toast.error(`${data.errors.length} channel${data.errors.length > 1 ? 's' : ''} failed to sync`);
      }
    } catch (err) {
      console.error('Failed to sync groups:', err);
      toast.error('Failed to sync groups');
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-sync on first visit if no groups exist
  useEffect(() => {
    if (!loading && groups.length === 0 && !hasAutoSynced.current) {
      hasAutoSynced.current = true;
      syncGroups();
    }
  }, [loading, groups.length, syncGroups]);

  const toggleMonitoring = useCallback(async (groupId: string, enabled: boolean) => {
    await api.patch(`/groups/${groupId}`, { monitoring_enabled: enabled });
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, monitoring_enabled: enabled } : g))
    );
  }, []);

  const bulkToggleMonitoring = useCallback(async (groupIds: string[], enabled: boolean) => {
    await Promise.all(
      groupIds.map((id) => api.patch(`/groups/${id}`, { monitoring_enabled: enabled }))
    );
    setGroups((prev) =>
      prev.map((g) => groupIds.includes(g.id) ? { ...g, monitoring_enabled: enabled } : g)
    );
  }, []);

  return { groups, loading, syncing, refetch: fetchGroups, syncGroups, toggleMonitoring, bulkToggleMonitoring };
}
