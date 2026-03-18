import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupCriteriaMatch } from '@/types/groups';

export function useMatchedMessages() {
  const [matches, setMatches] = useState<GroupCriteriaMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [filterCriteriaId, setFilterCriteriaId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterGroupId) params.set('group_id', filterGroupId);
      if (filterCriteriaId) params.set('criteria_id', filterCriteriaId);
      const { data } = await api.get(`/groups/all-matches?${params}`);
      setMatches(data.matches || []);
    } catch (err) {
      console.error('Failed to fetch matched messages:', err);
    } finally {
      setLoading(false);
    }
  }, [filterGroupId, filterCriteriaId]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  return {
    matches,
    loading,
    filterGroupId,
    filterCriteriaId,
    setFilterGroupId,
    setFilterCriteriaId,
    setMatches,
    refetch: fetchMatches,
  };
}
