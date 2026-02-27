import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { ProfileData, ScheduleMode } from '@/hooks/useCompanyAI';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';

export interface ChannelAgentSettings {
  is_enabled: boolean;
  custom_instructions: string | null;
  profile_data: ProfileData;
  max_tokens: number;
  schedule_mode: ScheduleMode;
  ai_schedule: BusinessHours | null;
  outside_hours_message: string | null;
  default_language: string;
  business_hours: BusinessHours | null;
}

const DEFAULT_SETTINGS: ChannelAgentSettings = {
  is_enabled: true,
  custom_instructions: null,
  profile_data: {},
  max_tokens: 500,
  schedule_mode: 'always_on',
  ai_schedule: null,
  outside_hours_message: null,
  default_language: 'en',
  business_hours: null,
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
