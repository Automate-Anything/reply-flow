import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { ProfileData } from './useCompanyAI';

export interface AIAgent {
  id: string;
  company_id: string;
  name: string;
  profile_data: ProfileData;
  channel_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const { data } = await api.get('/agents');
      setAgents(data.agents || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAgents();
  }, [fetchAgents]);

  const createAgent = useCallback(
    async (body: { name?: string; profile_data?: ProfileData }) => {
      const { data } = await api.post('/agents', body);
      setAgents((prev) => [...prev, data.agent]);
      return data.agent as AIAgent;
    },
    []
  );

  const deleteAgent = useCallback(
    async (agentId: string) => {
      await api.delete(`/agents/${agentId}`);
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
    },
    []
  );

  return {
    agents,
    loading,
    createAgent,
    deleteAgent,
    refetch: fetchAgents,
  };
}

export function useAgent(agentId: string | undefined) {
  const [agent, setAgent] = useState<AIAgent | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAgent = useCallback(async () => {
    if (!agentId) return;
    try {
      const { data } = await api.get(`/agents/${agentId}`);
      setAgent(data.agent);
    } catch (err) {
      console.error('Failed to fetch agent:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setAgent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAgent();
  }, [fetchAgent, agentId]);

  const updateAgent = useCallback(
    async (updates: { name?: string; profile_data?: ProfileData }) => {
      if (!agentId) return;
      const { data } = await api.put(`/agents/${agentId}`, updates);
      setAgent(data.agent);
      return data.agent as AIAgent;
    },
    [agentId]
  );

  return {
    agent,
    loading,
    updateAgent,
    refetch: fetchAgent,
  };
}
