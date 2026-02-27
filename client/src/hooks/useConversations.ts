import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ConversationLabel {
  id: string;
  name: string;
  color: string;
}

export interface AssignedUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface Conversation {
  id: string;
  chat_id: string;
  channel_id: number | null;
  contact_id: string | null;
  phone_number: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  is_archived: boolean;
  is_starred: boolean;
  snoozed_until: string | null;
  assigned_to: string | null;
  assigned_user: AssignedUser | null;
  human_takeover: boolean;
  marked_unread: boolean;
  unread_count: number;
  labels: ConversationLabel[];
  created_at: string;
}

export interface ConversationFilters {
  status?: string;
  assignee?: string;
  priority?: string;
  starred?: boolean;
  snoozed?: boolean;
  sort?: 'newest' | 'oldest';
  labelId?: string;
}

export function useConversations(
  search?: string,
  workspaceId?: string | null,
  filters?: ConversationFilters
) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (workspaceId) params.set('workspaceId', workspaceId);
      if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters?.assignee && filters.assignee !== 'all') params.set('assignee', filters.assignee);
      if (filters?.priority && filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters?.starred) params.set('starred', 'true');
      if (filters?.snoozed) params.set('snoozed', 'true');
      if (filters?.sort) params.set('sort', filters.sort);
      if (filters?.labelId) params.set('labelId', filters.labelId);
      const { data } = await api.get(`/conversations?${params}`);
      setConversations(data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [search, workspaceId, filters]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return { conversations, setConversations, loading, refetch: fetchConversations };
}
