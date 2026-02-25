import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface AISettings {
  is_enabled: boolean;
  system_prompt: string;
  max_tokens: number;
}

export function useAISettings() {
  const [settings, setSettings] = useState<AISettings>({
    is_enabled: false,
    system_prompt: 'You are a helpful business assistant. Respond professionally and concisely.',
    max_tokens: 500,
  });
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/ai/settings');
      setSettings(data.settings);
    } catch (err) {
      console.error('Failed to fetch AI settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(async (updates: Partial<AISettings>) => {
    const { data } = await api.put('/ai/settings', updates);
    setSettings(data.settings);
    return data.settings;
  }, []);

  return { settings, loading, updateSettings, refetch: fetchSettings };
}
