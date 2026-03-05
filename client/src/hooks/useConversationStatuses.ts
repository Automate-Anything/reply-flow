import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ConversationStatus {
  id: string;
  name: string;
  color: string;
  group: 'open' | 'closed';
  sort_order: number;
  is_default: boolean;
}

export function useConversationStatuses() {
  const [statuses, setStatuses] = useState<ConversationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async () => {
    try {
      const { data } = await api.get('/conversation-statuses');
      setStatuses(data.statuses || []);
    } catch (err) {
      console.error('Failed to fetch conversation statuses:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  return { statuses, loading, refetch: fetchStatuses };
}
