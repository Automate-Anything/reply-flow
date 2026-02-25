import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface Contact {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  tags: string[];
  whatsapp_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function useContacts(search?: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await api.get(`/contacts?${params}`);
      setContacts(data.contacts || []);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  return { contacts, loading, refetch: fetchContacts };
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
      console.error('Failed to fetch notes:', err);
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

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!contactId) return;
      await api.delete(`/contact-notes/${contactId}/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    },
    [contactId]
  );

  return { notes, loading, addNote, deleteNote, refetch: fetchNotes };
}
