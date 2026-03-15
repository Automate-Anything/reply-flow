import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface AutoAssignMember {
  id: string;
  user_id: string;
  is_available: boolean;
  last_assigned_at: string | null;
  user: { id: string; full_name: string; avatar_url: string | null };
}

export interface AutoAssignRule {
  id: string;
  channel_id: number | null;
  strategy: 'round_robin' | 'least_busy' | 'tag_based';
  config: Record<string, unknown>;
  is_active: boolean;
  members: AutoAssignMember[];
  created_at: string;
}

export function useAutoAssignRules() {
  const [rules, setRules] = useState<AutoAssignRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    try {
      const { data } = await api.get('/auto-assign/rules');
      setRules(data.rules || []);
    } catch {
      console.error('Failed to fetch auto-assign rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const createRule = useCallback(
    async (payload: {
      channel_id?: number | null;
      strategy: string;
      config?: Record<string, unknown>;
      member_ids?: string[];
    }) => {
      const { data } = await api.post('/auto-assign/rules', payload);
      await fetchRules();
      return data.rule;
    },
    [fetchRules]
  );

  const updateRule = useCallback(
    async (ruleId: string, payload: Record<string, unknown>) => {
      await api.put(`/auto-assign/rules/${ruleId}`, payload);
      await fetchRules();
    },
    [fetchRules]
  );

  const deleteRule = useCallback(
    async (ruleId: string) => {
      await api.delete(`/auto-assign/rules/${ruleId}`);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    },
    []
  );

  return { rules, loading, refetch: fetchRules, createRule, updateRule, deleteRule };
}
