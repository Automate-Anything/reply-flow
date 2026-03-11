import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/contexts/SessionContext';
import api from '@/lib/api';

export function useDebugMode(enabled = true) {
  const { isSuperAdmin } = useSession();
  const [debugMode, setDebugMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchDebugMode = useCallback(async () => {
    if (!enabled || !isSuperAdmin) {
      setDebugMode(false);
      return;
    }
    try {
      const { data } = await api.get<{ enabled: boolean }>('/super-admin/debug-mode');
      setDebugMode(data.enabled);
    } catch {
      // Silently fail — debug mode stays off
    }
  }, [enabled, isSuperAdmin]);

  const toggleDebugMode = useCallback(async (enabled: boolean) => {
    setLoading(true);
    try {
      const { data } = await api.post<{ enabled: boolean }>('/super-admin/debug-mode/toggle', { enabled });
      setDebugMode(data.enabled);
      return data.enabled;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !isSuperAdmin) {
      setDebugMode(false);
      return;
    }
    fetchDebugMode();
  }, [enabled, fetchDebugMode, isSuperAdmin]);

  return { debugMode: isSuperAdmin && debugMode, toggleDebugMode, loading };
}
