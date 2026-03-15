// client/src/hooks/usePermissions.ts
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export type AccessLevel = 'no_access' | 'view' | 'reply' | 'manage';

export interface PermissionEntry {
  id: string;
  user_id: string | null;
  access_level: AccessLevel;
  created_at: string;
  user: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  } | null;
}

export interface ChannelPermissionSettings {
  mode: 'private' | 'specific_users' | 'all_members';
  defaultLevel: AccessLevel | null;
  owner: { id: string; full_name: string; email: string; avatar_url: string | null };
  permissions: PermissionEntry[];
}

export interface ConversationPermissionSettings {
  channelDefaultLevel: AccessLevel | null;
  permissions: PermissionEntry[];
  inherited: PermissionEntry[];
}

export interface PermissionConflict {
  userId: string;
  userName: string;
  sessionIds: string[];
  currentChannelLevel: AccessLevel;
  conversationOverrides: Array<{ sessionId: string; accessLevel: AccessLevel }>;
}

export interface ConflictResolution {
  userId: string;
  action: 'keep' | 'remove';
}

export function useChannelPermissions(channelId: number | null) {
  const [settings, setSettings] = useState<ChannelPermissionSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/channels/${channelId}`);
      setSettings(data);
    } catch {
      // Silently ignore (user may not have manage access)
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const grantAccess = useCallback(async (userId: string | 'all', level: AccessLevel) => {
    if (!channelId) return;
    await api.put(`/access/channels/${channelId}/users/${userId}`, { access_level: level });
    await fetchSettings();
  }, [channelId, fetchSettings]);

  const revokeAccess = useCallback(async (userId: string | 'all') => {
    if (!channelId) return;
    await api.delete(`/access/channels/${channelId}/users/${userId}`);
    await fetchSettings();
  }, [channelId, fetchSettings]);

  const checkConflicts = useCallback(async (
    proposedChange: { removeAllMembersRow?: boolean; removeUserIds?: string[]; addNoAccessUserIds?: string[] }
  ): Promise<PermissionConflict[]> => {
    if (!channelId) return [];
    const { data } = await api.post(`/access/channels/${channelId}/check-conflicts`, proposedChange);
    return data.conflicts;
  }, [channelId]);

  const resolveConflicts = useCallback(async (
    proposedChange: Record<string, unknown>,
    resolutions: ConflictResolution[]
  ) => {
    if (!channelId) return;
    await api.post(`/access/channels/${channelId}/resolve-conflicts`, {
      proposedChange,
      resolutions,
    });
    await fetchSettings();
  }, [channelId, fetchSettings]);

  return { settings, loading, fetchSettings, grantAccess, revokeAccess, checkConflicts, resolveConflicts };
}

export function useConversationPermissions(sessionId: string | null) {
  const [settings, setSettings] = useState<ConversationPermissionSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/conversations/${sessionId}`);
      setSettings(data);
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const grantOverride = useCallback(async (userId: string | 'all', level: AccessLevel) => {
    if (!sessionId) return;
    await api.put(`/access/conversations/${sessionId}/users/${userId}`, { access_level: level });
    await fetchSettings();
  }, [sessionId, fetchSettings]);

  const removeOverride = useCallback(async (userId: string | 'all') => {
    if (!sessionId) return;
    await api.delete(`/access/conversations/${sessionId}/users/${userId}`);
    await fetchSettings();
  }, [sessionId, fetchSettings]);

  return { settings, loading, fetchSettings, grantOverride, removeOverride };
}
