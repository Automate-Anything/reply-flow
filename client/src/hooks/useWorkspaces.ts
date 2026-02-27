import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface Workspace {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  channel_count: number;
  ai_enabled: boolean;
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const { data } = await api.get('/workspaces');
      setWorkspaces(data.workspaces || []);
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const createWorkspace = useCallback(
    async (params: { name: string; description?: string }) => {
      const { data } = await api.post('/workspaces', params);
      setWorkspaces((prev) => [{ ...data.workspace, channel_count: 0, ai_enabled: false }, ...prev]);
      return data.workspace;
    },
    []
  );

  const updateWorkspace = useCallback(
    async (workspaceId: string, params: { name?: string; description?: string }) => {
      const { data } = await api.put(`/workspaces/${workspaceId}`, params);
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === workspaceId ? { ...ws, ...data.workspace } : ws))
      );
      return data.workspace;
    },
    []
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      await api.delete(`/workspaces/${workspaceId}`);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId));
    },
    []
  );

  const assignChannel = useCallback(
    async (workspaceId: string, channelId: number) => {
      await api.post(`/workspaces/${workspaceId}/channels`, { channelId });
    },
    []
  );

  const removeChannel = useCallback(
    async (workspaceId: string, channelId: number) => {
      await api.delete(`/workspaces/${workspaceId}/channels/${channelId}`);
    },
    []
  );

  return {
    workspaces,
    loading,
    refetch: fetchWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    assignChannel,
    removeChannel,
  };
}
