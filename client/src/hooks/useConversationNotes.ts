import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ConversationNote {
  id: string;
  session_id: string;
  content: string;
  created_by: string;
  author: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export function useConversationNotes(sessionId: string | null) {
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!sessionId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/conversation-notes/${sessionId}`);
      setNotes(data.notes || []);
    } catch (err) {
      console.error('Failed to fetch conversation notes:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = useCallback(
    async (content: string) => {
      if (!sessionId) return;
      const { data } = await api.post(`/conversation-notes/${sessionId}`, { content });
      setNotes((prev) => [data.note, ...prev]);
      return data.note;
    },
    [sessionId]
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!sessionId) return;
      await api.delete(`/conversation-notes/${sessionId}/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [sessionId]
  );

  return { notes, loading, addNote, deleteNote, refetch: fetchNotes };
}
