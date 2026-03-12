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
  status: string;
  priority: string;
  is_archived: boolean;
  is_starred: boolean;
  snoozed_until: string | null;
  assigned_to: string | null;
  assigned_user: AssignedUser | null;
  human_takeover: boolean;
  marked_unread: boolean;
  pinned_at: string | null;
  draft_message: string | null;
  unread_count: number;
  labels: ConversationLabel[];
  contact_session_count: number;
  profile_picture_url: string | null;
  created_at: string;
}

export interface ConversationFilters {
  status?: string[];
  assignee?: string[];
  priority?: string[];
  starred?: boolean;
  snoozed?: boolean;
  unread?: boolean;
  sort?: 'newest' | 'oldest';
  labelId?: string;
}

const CONVS_CACHE_KEY = 'reply-flow-conversations';

function getCachedConversations(): Conversation[] | null {
  try {
    const cached = localStorage.getItem(CONVS_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function isDefaultQuery(search?: string, filters?: ConversationFilters): boolean {
  return !search && (!filters || Object.keys(filters).length === 0 ||
    (Object.keys(filters).length === 1 && filters.sort !== undefined));
}

export function useConversations(
  search?: string,
  filters?: ConversationFilters
) {
  const isDefault = isDefaultQuery(search, filters);
  const cached = isDefault ? getCachedConversations() : null;

  const [conversations, setConversations] = useState<Conversation[]>(cached || []);
  const [loading, setLoading] = useState(!cached);

  // Reset loading state when query parameters change (e.g. tab switch)
  // so the UI shows a skeleton instead of stale data from the previous query.
  useEffect(() => {
    const nowDefault = isDefaultQuery(search, filters);
    const hasCached = nowDefault && getCachedConversations() !== null;
    if (!hasCached) setLoading(true);
  }, [search, filters]);

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filters?.status && filters.status.length > 0 && !filters.status.includes('all')) {
        if (filters.status.includes('snoozed')) {
          params.set('snoozed', 'true');
        } else {
          params.set('status', filters.status.join(','));
        }
      }
      if (filters?.assignee && filters.assignee.length > 0 && !filters.assignee.includes('all')) {
        params.set('assignee', filters.assignee.join(','));
      }
      if (filters?.priority && filters.priority.length > 0 && !filters.priority.includes('all')) {
        params.set('priority', filters.priority.join(','));
      }
      if (filters?.starred) params.set('starred', 'true');
      if (filters?.snoozed) params.set('snoozed', 'true');
      if (filters?.unread) params.set('unread', 'true');
      if (filters?.sort) params.set('sort', filters.sort);
      if (filters?.labelId) params.set('labelId', filters.labelId);
      const { data } = await api.get(`/conversations?${params}`);
      const sessions = data.sessions || [];
      setConversations(sessions);
      // Cache default query results for instant load next time
      if (isDefaultQuery(search, filters)) {
        try {
          localStorage.setItem(CONVS_CACHE_KEY, JSON.stringify(sessions));
        } catch {
          // localStorage full — ignore
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [search, filters]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return { conversations, setConversations, loading, refetch: fetchConversations };
}
