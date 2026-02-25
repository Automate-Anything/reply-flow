import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { Conversation } from './useConversations';
import type { AISettings } from './useAISettings';

interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  channel_status: string;
  phone_number: string | null;
  webhook_registered: boolean;
}

export interface DashboardData {
  totalConversations: number;
  unreadCount: number;
  totalContacts: number;
  recentConversations: Conversation[];
  channel: ChannelInfo | null;
  aiSettings: AISettings;
}

const DEFAULT_DATA: DashboardData = {
  totalConversations: 0,
  unreadCount: 0,
  totalContacts: 0,
  recentConversations: [],
  channel: null,
  aiSettings: { is_enabled: false, system_prompt: '', max_tokens: 500 },
};

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [convsRes, contactsRes, channelRes, aiRes] = await Promise.all([
      api.get('/conversations').catch(() => ({ data: { sessions: [] } })),
      api.get('/contacts').catch(() => ({ data: { contacts: [] } })),
      api.get('/whatsapp/channel').catch(() => ({ data: { channel: null } })),
      api.get('/ai/settings').catch(() => ({
        data: { settings: { is_enabled: false, system_prompt: '', max_tokens: 500 } },
      })),
    ]);

    const allConversations: Conversation[] = convsRes.data.sessions || [];
    const contacts = contactsRes.data.contacts || [];

    setData({
      totalConversations: allConversations.length,
      unreadCount: allConversations.reduce(
        (sum: number, c: Conversation) => sum + c.unread_count,
        0
      ),
      totalContacts: contacts.length,
      recentConversations: allConversations.slice(0, 5),
      channel: channelRes.data.channel || null,
      aiSettings: aiRes.data.settings || DEFAULT_DATA.aiSettings,
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { data, loading, refetch: fetchAll };
}
