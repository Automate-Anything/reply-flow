import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface CannedResponse {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  category: string | null;
  created_at: string;
}

export function useCannedResponses() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchResponses = useCallback(async () => {
    try {
      const { data } = await api.get('/canned-responses');
      setResponses(data.responses || []);
    } catch (err) {
      console.error('Failed to fetch canned responses:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResponses();
  }, [fetchResponses]);

  const create = useCallback(
    async (payload: { title: string; content: string; shortcut?: string; category?: string }) => {
      const { data } = await api.post('/canned-responses', payload);
      setResponses((prev) => [...prev, data.response].sort((a, b) => a.title.localeCompare(b.title)));
      return data.response;
    },
    []
  );

  const update = useCallback(
    async (id: string, payload: { title?: string; content?: string; shortcut?: string; category?: string }) => {
      const { data } = await api.put(`/canned-responses/${id}`, payload);
      setResponses((prev) => prev.map((r) => (r.id === id ? data.response : r)));
      return data.response;
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    await api.delete(`/canned-responses/${id}`);
    setResponses((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { responses, loading, create, update, remove, refetch: fetchResponses };
}
