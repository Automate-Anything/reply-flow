import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ConversationLabel {
  id: string;
  name: string;
  color: string;
}

export interface Conversation {
  id: string;
  chat_id: string;
  channel_id: number | null;
  phone_number: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
  status: string;
  is_archived: boolean;
  human_takeover: boolean;
  marked_unread: boolean;
  unread_count: number;
  labels: ConversationLabel[];
  created_at: string;
}

export function useConversations(search?: string, workspaceId?: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (workspaceId) params.set('workspaceId', workspaceId);
      const { data } = await api.get(`/conversations?${params}`);
      setConversations(data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [search, workspaceId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return { conversations, setConversations, loading, refetch: fetchConversations };
}
