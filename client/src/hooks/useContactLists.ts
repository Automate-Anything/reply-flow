import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ContactList {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_count?: number;
  created_at: string;
}

export function useContactLists() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLists = useCallback(async () => {
    try {
      const { data } = await api.get('/contact-lists');
      setLists(data.lists || []);
    } catch {
      console.error('Failed to fetch contact lists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const createList = useCallback(async (name: string, description?: string, color?: string) => {
    const { data } = await api.post('/contact-lists', { name, description, color });
    setLists((prev) => [...prev, data.list]);
    return data.list as ContactList;
  }, []);

  const updateList = useCallback(async (listId: string, updates: { name?: string; description?: string; color?: string }) => {
    const { data } = await api.put(`/contact-lists/${listId}`, updates);
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, ...data.list } : l)));
  }, []);

  const deleteList = useCallback(async (listId: string) => {
    await api.delete(`/contact-lists/${listId}`);
    setLists((prev) => prev.filter((l) => l.id !== listId));
  }, []);

  const addMembers = useCallback(async (listId: string, contactIds: string[]) => {
    await api.post(`/contact-lists/${listId}/members`, { contactIds });
  }, []);

  const removeMembers = useCallback(async (listId: string, contactIds: string[]) => {
    await api.delete(`/contact-lists/${listId}/members`, { data: { contactIds } });
  }, []);

  return { lists, loading, refetch: fetchLists, createList, updateList, deleteList, addMembers, removeMembers };
}
