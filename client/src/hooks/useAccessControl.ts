import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface AccessEntry {
  id: string;
  user_id: string;
  access_level: 'view' | 'edit';
  created_at: string;
  user: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  } | null;
}

// ────────────────────────────────────────────────────────────
// Channel Access
// ────────────────────────────────────────────────────────────

export interface OwnerInfo {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export interface ChannelAccessSettings {
  sharing_mode: 'private' | 'specific_users' | 'all_members';
  default_conversation_visibility: 'all' | 'owner_only';
  owner: OwnerInfo;
  access_list: AccessEntry[];
}

export function useChannelAccess(channelId: number | null) {
  const [settings, setSettings] = useState<ChannelAccessSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/channels/${channelId}`);
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch channel access settings:', err);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: {
    sharing_mode?: string;
    default_conversation_visibility?: string;
  }) => {
    if (!channelId || !settings) return;
    // Optimistic update
    setSettings({ ...settings, ...updates } as ChannelAccessSettings);
    try {
      await api.patch(`/access/channels/${channelId}`, updates);
      await fetchSettings();
    } catch (err) {
      // Revert on failure
      setSettings(settings);
      throw err;
    }
  };

  const grantAccess = async (userId: string, accessLevel: 'view' | 'edit') => {
    if (!channelId) return;
    await api.put(`/access/channels/${channelId}/users/${userId}`, {
      access_level: accessLevel,
    });
    await fetchSettings();
  };

  const revokeAccess = async (userId: string) => {
    if (!channelId) return;
    await api.delete(`/access/channels/${channelId}/users/${userId}`);
    await fetchSettings();
  };

  return { settings, loading, refetch: fetchSettings, updateSettings, grantAccess, revokeAccess };
}

// ────────────────────────────────────────────────────────────
// Conversation Access
// ────────────────────────────────────────────────────────────

export interface ConversationAccessSettings {
  default_conversation_visibility: 'all' | 'owner_only';
  access_list: AccessEntry[];
}

export function useConversationAccess(sessionId: string | null) {
  const [settings, setSettings] = useState<ConversationAccessSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/conversations/${sessionId}`);
      setSettings(data);
    } catch {
      // User may not be the channel owner — silently ignore
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const grantAccess = async (userId: string, accessLevel: 'view' | 'edit') => {
    if (!sessionId) return;
    await api.put(`/access/conversations/${sessionId}/users/${userId}`, {
      access_level: accessLevel,
    });
    await fetchSettings();
  };

  const grantAccessToAll = async (accessLevel: 'view' | 'edit') => {
    if (!sessionId) return;
    await api.put(`/access/conversations/${sessionId}/users/all`, {
      access_level: accessLevel,
    });
    await fetchSettings();
  };

  const revokeAccess = async (userId: string) => {
    if (!sessionId) return;
    await api.delete(`/access/conversations/${sessionId}/users/${userId}`);
    await fetchSettings();
  };

  const revokeAccessFromAll = async () => {
    if (!sessionId) return;
    await api.delete(`/access/conversations/${sessionId}/users/all`);
    await fetchSettings();
  };

  return {
    settings,
    loading,
    refetch: fetchSettings,
    grantAccess,
    grantAccessToAll,
    revokeAccess,
    revokeAccessFromAll,
  };
}

// ────────────────────────────────────────────────────────────
// Contact Access
// ────────────────────────────────────────────────────────────

export interface ContactAccessSettings {
  sharing_mode: 'private' | 'specific_users' | 'all_members';
  access_list: AccessEntry[];
}

export function useContactAccess(contactId: string | null) {
  const [settings, setSettings] = useState<ContactAccessSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/contacts/${contactId}`);
      setSettings(data);
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSharingMode = async (sharingMode: string) => {
    if (!contactId) return;
    await api.patch(`/access/contacts/${contactId}`, { sharing_mode: sharingMode });
    await fetchSettings();
  };

  const grantAccess = async (userId: string, accessLevel: 'view' | 'edit') => {
    if (!contactId) return;
    await api.put(`/access/contacts/${contactId}/users/${userId}`, {
      access_level: accessLevel,
    });
    await fetchSettings();
  };

  const revokeAccess = async (userId: string) => {
    if (!contactId) return;
    await api.delete(`/access/contacts/${contactId}/users/${userId}`);
    await fetchSettings();
  };

  return { settings, loading, refetch: fetchSettings, updateSharingMode, grantAccess, revokeAccess };
}
