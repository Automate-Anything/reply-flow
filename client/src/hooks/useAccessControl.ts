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
