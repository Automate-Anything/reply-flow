import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface KBEntry {
  id: string;
  title: string;
  content: string;
  source_type: 'text' | 'file';
  file_name: string | null;
  file_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useCompanyKB() {
  const [kbEntries, setKbEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchKB = useCallback(async () => {
    try {
      const { data } = await api.get('/ai/kb');
      setKbEntries(data.entries);
    } catch (err) {
      console.error('Failed to fetch KB entries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKB();
  }, [fetchKB]);

  const addKBEntry = useCallback(async (entry: { title: string; content: string }) => {
    const { data } = await api.post('/ai/kb', entry);
    setKbEntries((prev) => [data.entry, ...prev]);
    return data.entry;
  }, []);

  const uploadKBFile = useCallback(async (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const { data } = await api.post('/ai/kb/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setKbEntries((prev) => [data.entry, ...prev]);
    return data.entry;
  }, []);

  const updateKBEntry = useCallback(
    async (entryId: string, updates: { title?: string; content?: string }) => {
      const { data } = await api.put(`/ai/kb/entry/${entryId}`, updates);
      setKbEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      return data.entry;
    },
    []
  );

  const deleteKBEntry = useCallback(async (entryId: string) => {
    await api.delete(`/ai/kb/entry/${entryId}`);
    setKbEntries((prev) => prev.filter((e) => e.id !== entryId));
  }, []);

  return {
    kbEntries,
    loading,
    addKBEntry,
    uploadKBFile,
    updateKBEntry,
    deleteKBEntry,
    refetch: fetchKB,
  };
}
