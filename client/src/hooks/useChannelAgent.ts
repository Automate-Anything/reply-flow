import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ChannelAgentSettings {
  is_enabled: boolean;
  custom_instructions: string | null;
  greeting_override: string | null;
  max_tokens_override: number | null;
}

const DEFAULT_SETTINGS: ChannelAgentSettings = {
  is_enabled: true,
  custom_instructions: null,
  greeting_override: null,
  max_tokens_override: null,
};

export function useChannelAgent(channelId: number | undefined) {
  const [settings, setSettings] = useState<ChannelAgentSettings>(DEFAULT_SETTINGS);
  const [assignedEntryIds, setAssignedEntryIds] = useState<string[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!channelId) return;
    try {
      const { data } = await api.get(`/ai/channel-settings/${channelId}`);
      setSettings(data.settings);
    } catch (err) {
      console.error('Failed to fetch channel agent settings:', err);
    } finally {
      setLoadingSettings(false);
    }
  }, [channelId]);

  const fetchAssignments = useCallback(async () => {
    if (!channelId) return;
    try {
      const { data } = await api.get(`/ai/kb-assignments/${channelId}`);
      setAssignedEntryIds(data.assigned_entry_ids || []);
    } catch (err) {
      console.error('Failed to fetch KB assignments:', err);
    } finally {
      setLoadingAssignments(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (!channelId) {
      setSettings(DEFAULT_SETTINGS);
      setAssignedEntryIds([]);
      setLoadingSettings(false);
      setLoadingAssignments(false);
      return;
    }
    setLoadingSettings(true);
    setLoadingAssignments(true);
    fetchSettings();
    fetchAssignments();
  }, [fetchSettings, fetchAssignments, channelId]);

  const updateSettings = useCallback(
    async (updates: Partial<ChannelAgentSettings>) => {
      if (!channelId) return;
      const { data } = await api.put(`/ai/channel-settings/${channelId}`, updates);
      setSettings(data.settings);
      return data.settings;
    },
    [channelId]
  );

  const updateAssignments = useCallback(
    async (entryIds: string[]) => {
      if (!channelId) return;
      const { data } = await api.put(`/ai/kb-assignments/${channelId}`, { entryIds });
      setAssignedEntryIds(data.assigned_entry_ids || []);
    },
    [channelId]
  );

  return {
    settings,
    assignedEntryIds,
    loadingSettings,
    loadingAssignments,
    updateSettings,
    updateAssignments,
    refetchSettings: fetchSettings,
    refetchAssignments: fetchAssignments,
  };
}
