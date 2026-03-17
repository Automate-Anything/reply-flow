import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupChatMessage, GroupCriteriaMatch } from '@/types/groups';

export function useGroupMessages(groupId: string | null) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [matches, setMatches] = useState<GroupCriteriaMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!groupId) return;
    try {
      const [msgRes, matchRes] = await Promise.all([
        api.get(`/groups/${groupId}/messages`),
        api.get(`/groups/${groupId}/matches`),
      ]);
      setMessages(msgRes.data.messages || []);
      setMatches(matchRes.data.matches || []);
    } catch (err) {
      console.error('Failed to fetch group messages:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (groupId) {
      setLoading(true);
      fetchMessages();
    } else {
      setMessages([]);
      setMatches([]);
      setLoading(false);
    }
  }, [groupId, fetchMessages]);

  return { messages, matches, loading, refetch: fetchMessages, setMessages, setMatches };
}
