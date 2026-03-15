import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ContactNote {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  author?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  };
}

export function useContactNotes(contactId: string | null) {
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!contactId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/contact-notes/${contactId}`);
      setNotes(data.notes || []);
    } catch (err) {
      console.error('Failed to fetch contact notes:', err);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = useCallback(
    async (content: string) => {
      if (!contactId) return;
      const { data } = await api.post(`/contact-notes/${contactId}`, { content });
      setNotes((prev) => [data.note, ...prev]);
      return data.note;
    },
    [contactId]
  );

  const updateNote = useCallback(
    async (noteId: string, content: string) => {
      if (!contactId) return;
      const { data } = await api.put(`/contact-notes/${contactId}/${noteId}`, { content });
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, ...data.note } : n))
      );
      return data.note;
    },
    [contactId]
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!contactId) return;
      await api.delete(`/contact-notes/${contactId}/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [contactId]
  );

  return { notes, loading, refetch: fetchNotes, addNote, updateNote, deleteNote };
}
