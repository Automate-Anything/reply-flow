import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ProfileData {
  use_case?: 'business' | 'personal' | 'organization';
  business_name?: string;
  business_type?: string;
  business_description?: string;
  target_audience?: string;
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  language_preference?: 'match_customer' | string;
  response_length?: 'concise' | 'moderate' | 'detailed';
  response_rules?: string;
  greeting_message?: string;
}

export interface WorkspaceAIProfile {
  is_enabled: boolean;
  profile_data: ProfileData;
  max_tokens: number;
}

export interface KBEntry {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  source_type: 'text' | 'file';
  file_name: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_PROFILE: WorkspaceAIProfile = {
  is_enabled: false,
  profile_data: {},
  max_tokens: 500,
};

export function useWorkspaceAI(workspaceId: string | undefined) {
  const [profile, setProfile] = useState<WorkspaceAIProfile>(DEFAULT_PROFILE);
  const [kbEntries, setKbEntries] = useState<KBEntry[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingKB, setLoadingKB] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data } = await api.get(`/ai/profile/${workspaceId}`);
      setProfile(data.profile);
    } catch (err) {
      console.error('Failed to fetch AI profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, [workspaceId]);

  const fetchKB = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data } = await api.get(`/ai/kb/${workspaceId}`);
      setKbEntries(data.entries);
    } catch (err) {
      console.error('Failed to fetch KB entries:', err);
    } finally {
      setLoadingKB(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setProfile(DEFAULT_PROFILE);
      setKbEntries([]);
      setLoadingProfile(false);
      setLoadingKB(false);
      return;
    }
    setLoadingProfile(true);
    setLoadingKB(true);
    fetchProfile();
    fetchKB();
  }, [fetchProfile, fetchKB, workspaceId]);

  const updateProfile = useCallback(
    async (updates: Partial<WorkspaceAIProfile>) => {
      if (!workspaceId) return;
      const { data } = await api.put(`/ai/profile/${workspaceId}`, updates);
      setProfile(data.profile);
      return data.profile;
    },
    [workspaceId]
  );

  const addKBEntry = useCallback(
    async (entry: { title: string; content: string }) => {
      if (!workspaceId) return;
      const { data } = await api.post(`/ai/kb/${workspaceId}`, entry);
      setKbEntries((prev) => [data.entry, ...prev]);
      return data.entry;
    },
    [workspaceId]
  );

  const uploadKBFile = useCallback(
    async (file: File, title?: string) => {
      if (!workspaceId) return;
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);

      const { data } = await api.post(`/ai/kb/${workspaceId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setKbEntries((prev) => [data.entry, ...prev]);
      return data.entry;
    },
    [workspaceId]
  );

  const updateKBEntry = useCallback(
    async (entryId: string, updates: { title?: string; content?: string }) => {
      const { data } = await api.put(`/ai/kb/entry/${entryId}`, updates);
      setKbEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      return data.entry;
    },
    []
  );

  const deleteKBEntry = useCallback(
    async (entryId: string) => {
      await api.delete(`/ai/kb/entry/${entryId}`);
      setKbEntries((prev) => prev.filter((e) => e.id !== entryId));
    },
    []
  );

  return {
    profile,
    kbEntries,
    loadingProfile,
    loadingKB,
    updateProfile,
    addKBEntry,
    uploadKBFile,
    updateKBEntry,
    deleteKBEntry,
    refetchProfile: fetchProfile,
    refetchKB: fetchKB,
  };
}
