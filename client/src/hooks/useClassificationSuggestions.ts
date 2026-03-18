import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

export interface SuggestionItem {
  id: string;
  confidence: number;
  name?: string;
}

export interface ClassificationSuggestions {
  labels?: SuggestionItem[];
  priority?: SuggestionItem;
  status?: SuggestionItem;
  contact_tags?: SuggestionItem[];
  contact_lists?: SuggestionItem[];
  reasoning: string;
}

export interface ClassificationSuggestion {
  id: string;
  session_id: string;
  contact_id: string;
  trigger: 'auto' | 'manual';
  status: 'pending' | 'accepted' | 'dismissed' | 'applied';
  suggestions: ClassificationSuggestions;
  accepted_items: Record<string, unknown> | null;
  created_at: string;
  applied_at: string | null;
}

export interface PartialAccept {
  labels?: string[];
  priority?: boolean;
  status?: boolean;
  contact_tags?: string[];
  contact_lists?: string[];
}

export function useClassificationSuggestions(sessionId: string | null) {
  const [suggestions, setSuggestions] = useState<ClassificationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const hasPending = suggestions.some((s) => s.status === 'pending');

  const fetchSuggestions = useCallback(async () => {
    if (!sessionId) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/classification/suggestions/${sessionId}`);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Failed to fetch classification suggestions:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const classify = useCallback(async () => {
    if (!sessionId) return;
    setClassifying(true);
    try {
      await api.post(`/classification/classify/${sessionId}`);
      await fetchSuggestions();
    } finally {
      setClassifying(false);
    }
  }, [sessionId, fetchSuggestions]);

  const accept = useCallback(async (suggestionId: string) => {
    await api.post(`/classification/suggestions/${suggestionId}/accept`);
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'accepted' as const } : s))
    );
  }, []);

  const dismiss = useCallback(async (suggestionId: string) => {
    await api.post(`/classification/suggestions/${suggestionId}/dismiss`);
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'dismissed' as const } : s))
    );
  }, []);

  const acceptPartial = useCallback(async (suggestionId: string, partial: PartialAccept) => {
    await api.post(`/classification/suggestions/${suggestionId}/accept-partial`, { accept: partial });
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'accepted' as const } : s))
    );
  }, []);

  return {
    suggestions,
    loading,
    classifying,
    hasPending,
    classify,
    accept,
    dismiss,
    acceptPartial,
    refetch: fetchSuggestions,
  };
}
