import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { Conversation } from './useConversations';

interface ChannelInfo {
  id: number;
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
  channels: ChannelInfo[];
  connectedChannelCount: number;
  totalChannelCount: number;
}

const DEFAULT_DATA: DashboardData = {
  totalConversations: 0,
  unreadCount: 0,
  totalContacts: 0,
  recentConversations: [],
  channels: [],
  connectedChannelCount: 0,
  totalChannelCount: 0,
};

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [convsRes, contactsRes, channelsRes] = await Promise.all([
      api.get('/conversations').catch(() => ({ data: { sessions: [] } })),
      api.get('/contacts').catch(() => ({ data: { contacts: [] } })),
      api.get('/whatsapp/channels').catch(() => ({ data: { channels: [] } })),
    ]);

    const allConversations: Conversation[] = convsRes.data.sessions || [];
    const contacts = contactsRes.data.contacts || [];
    const channels: ChannelInfo[] = channelsRes.data.channels || [];

    setData({
      totalConversations: allConversations.length,
      unreadCount: allConversations.reduce(
        (sum: number, c: Conversation) => sum + c.unread_count,
        0
      ),
      totalContacts: contacts.length,
      recentConversations: allConversations.slice(0, 5),
      channels,
      connectedChannelCount: channels.filter((c) => c.channel_status === 'connected').length,
      totalChannelCount: channels.length,
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { data, loading, refetch: fetchAll };
}
