import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface TimelineEvent {
  type: 'activity' | 'note' | 'message';
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export function useContactActivity(contactId: string | null) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchActivity = useCallback(async () => {
    if (!contactId) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contactId}/activity?limit=30`);
      setEvents(data.events || []);
      setHasMore(data.hasMore || false);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const loadMore = useCallback(async () => {
    if (!contactId || events.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const lastTimestamp = events[events.length - 1].timestamp;
      const { data } = await api.get(
        `/contacts/${contactId}/activity?limit=30&before=${lastTimestamp}`
      );
      setEvents((prev) => [...prev, ...(data.events || [])]);
      setHasMore(data.hasMore || false);
    } catch (err) {
      console.error('Failed to load more activity:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [contactId, events, loadingMore]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return { events, loading, hasMore, loadMore, loadingMore, refetch: fetchActivity };
}
