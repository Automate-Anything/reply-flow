import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';

export interface ContactTag {
  id: string;
  name: string;
  color: string;
}

export function useContactTags() {
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTags = useCallback(async () => {
    try {
      const { data } = await api.get('/contact-tags');
      setTags(data.tags || []);
    } catch {
      console.error('Failed to fetch contact tags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const createTag = useCallback(async (name: string, color?: string) => {
    const { data } = await api.post('/contact-tags', { name, color });
    setTags((prev) => [...prev, data.tag]);
    return data.tag as ContactTag;
  }, []);

  const updateTag = useCallback(async (tagId: string, updates: { name?: string; color?: string }) => {
    const { data } = await api.put(`/contact-tags/${tagId}`, updates);
    setTags((prev) => prev.map((t) => (t.id === tagId ? data.tag : t)));
  }, []);

  const deleteTag = useCallback(async (tagId: string) => {
    await api.delete(`/contact-tags/${tagId}`);
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  }, []);

  return { tags, loading, refetch: fetchTags, createTag, updateTag, deleteTag };
}
