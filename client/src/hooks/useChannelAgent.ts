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
  schedule_configured: boolean;
  ai_schedule: BusinessHours | null;
  outside_hours_message: string | null;
  default_language: string;
  agent_id: string | null;
  response_mode: 'live' | 'test';
  test_contact_ids: string[];
  excluded_contact_ids: string[];
  auto_reply_enabled: boolean;
  auto_reply_message: string | null;
  auto_reply_messages: string[];
  auto_reply_trigger: 'outside_hours' | 'all_unavailable';
}

const DEFAULT_SETTINGS: ChannelAgentSettings = {
  is_enabled: true,
  custom_instructions: null,
  profile_data: {},
  max_tokens: 500,
  schedule_mode: 'always_on',
  schedule_configured: false,
  ai_schedule: null,
  outside_hours_message: null,
  default_language: 'en',
  agent_id: null,
  response_mode: 'live',
  test_contact_ids: [],
  excluded_contact_ids: [],
  auto_reply_enabled: false,
  auto_reply_message: null,
  auto_reply_messages: [],
  auto_reply_trigger: 'outside_hours',
};

export function useChannelAgent(channelId: number | undefined) {
  const [settings, setSettings] = useState<ChannelAgentSettings>(DEFAULT_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);

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

  useEffect(() => {
    if (!channelId) {
      setSettings(DEFAULT_SETTINGS);
      setLoadingSettings(false);
      return;
    }
    setLoadingSettings(true);
    fetchSettings();
  }, [fetchSettings, channelId]);

  const updateSettings = useCallback(
    async (updates: Partial<ChannelAgentSettings>) => {
      if (!channelId) return;
      const { data } = await api.put(`/ai/channel-settings/${channelId}`, updates);
      setSettings(data.settings);
      return data.settings;
    },
    [channelId]
  );

  return {
    settings,
    loadingSettings,
    updateSettings,
    refetchSettings: fetchSettings,
  };
}
