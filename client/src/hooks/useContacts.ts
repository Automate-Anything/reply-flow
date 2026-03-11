import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ContactFilters {
  tags?: string[];
  listId?: string;
  company?: string;
  city?: string;
  country?: string;
  createdAfter?: string;
  createdBefore?: string;
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'company';
  sortOrder?: 'asc' | 'desc';
  customFields?: Record<string, string>;
}

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
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  content: string;
  author: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

const CONTACTS_CACHE_KEY = 'reply-flow-contacts';

function getCachedContacts(): Contact[] | null {
  try {
    const cached = localStorage.getItem(CONTACTS_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function isDefaultContactQuery(search?: string, filters?: ContactFilters): boolean {
  return !search && (!filters || Object.keys(filters).length === 0 ||
    (Object.keys(filters).length === 1 && (filters.sortBy !== undefined || filters.sortOrder !== undefined)));
}

export function useContacts(search?: string, filters?: ContactFilters) {
  const isDefault = isDefaultContactQuery(search, filters);
  const cached = isDefault ? getCachedContacts() : null;
  const [contacts, setContacts] = useState<Contact[]>(cached || []);
  const [loading, setLoading] = useState(!cached);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
      if (filters?.listId) params.set('listId', filters.listId);
      if (filters?.company) params.set('company', filters.company);
      if (filters?.city) params.set('city', filters.city);
      if (filters?.country) params.set('country', filters.country);
      if (filters?.createdAfter) params.set('createdAfter', filters.createdAfter);
      if (filters?.createdBefore) params.set('createdBefore', filters.createdBefore);
      if (filters?.sortBy) params.set('sortBy', filters.sortBy);
      if (filters?.sortOrder) params.set('sortOrder', filters.sortOrder);
      if (filters?.customFields) {
        for (const [defId, value] of Object.entries(filters.customFields)) {
          if (value) params.set(`cf[${defId}]`, value);
        }
      }
      const { data } = await api.get(`/contacts?${params}`);
      const contactList = data.contacts || [];
      setContacts(contactList);
      if (isDefaultContactQuery(search, filters)) {
        try {
          localStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(contactList));
        } catch {
          // localStorage full — ignore
        }
      }
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    } finally {
      setLoading(false);
    }
  }, [search, filters?.tags?.join(','), filters?.listId, filters?.company, filters?.city, filters?.country, filters?.createdAfter, filters?.createdBefore, filters?.sortBy, filters?.sortOrder, JSON.stringify(filters?.customFields)]);

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
