import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { Contact } from './useContacts';

export interface DuplicateGroup {
  contacts: Contact[];
  matchType: 'email' | 'name';
  confidence: number;
}

export interface SingleDuplicate {
  contact: Contact;
  matchType: 'email' | 'name';
  confidence: number;
}

export function useContactDuplicates() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/contacts/duplicates');
      setGroups(data.groups || []);
    } catch (err) {
      console.error('Failed to scan for duplicates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { groups, loading, scan };
}

export function useSingleContactDuplicates(contactId: string | null) {
  const [duplicates, setDuplicates] = useState<SingleDuplicate[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDuplicates = useCallback(async () => {
    if (!contactId) {
      setDuplicates([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contactId}/duplicates`);
      setDuplicates(data.duplicates || []);
    } catch {
      setDuplicates([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  return { duplicates, loading, refetch: fetchDuplicates };
}
