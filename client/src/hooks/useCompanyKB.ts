import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  entry_count: number;
  created_at: string;
  updated_at: string;
}

export interface KBEntry {
  id: string;
  title: string;
  content: string;
  source_type: 'text' | 'file';
  file_name: string | null;
  file_url: string | null;
  knowledge_base_id: string;
  embedding_status?: 'pending' | 'processing' | 'completed' | 'failed';
  chunk_count?: number;
  created_at: string;
  updated_at: string;
}

export interface KBChunk {
  id: string;
  chunk_index: number;
  content: string;
  metadata: {
    sourceEntryTitle: string;
    sourceFileName: string | null;
    sourceType: string;
    sectionHeading: string | null;
    sectionHierarchy: string[];
    chunkIndex: number;
    totalChunks: number;
  };
  created_at: string;
}

export interface KBSearchResult {
  id: string;
  entryId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  rrfScore: number;
  vectorRank: number;
  ftsRank: number;
  relevanceReason?: string | null;
  snippet?: string;
}

export function useCompanyKB() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Knowledge Bases ──

  const fetchKnowledgeBases = useCallback(async () => {
    try {
      const { data } = await api.get('/ai/kbs');
      setKnowledgeBases(data.knowledge_bases);
    } catch (err) {
      console.error('Failed to fetch knowledge bases:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKnowledgeBases();
  }, [fetchKnowledgeBases]);

  const createKnowledgeBase = useCallback(async (name: string, description?: string) => {
    const { data } = await api.post('/ai/kbs', { name, description });
    setKnowledgeBases((prev) => [data.knowledge_base, ...prev]);
    return data.knowledge_base as KnowledgeBase;
  }, []);

  const updateKnowledgeBase = useCallback(
    async (kbId: string, updates: { name?: string; description?: string }) => {
      const { data } = await api.put(`/ai/kbs/${kbId}`, updates);
      setKnowledgeBases((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, ...data.knowledge_base } : kb))
      );
      return data.knowledge_base as KnowledgeBase;
    },
    []
  );

  const deleteKnowledgeBase = useCallback(async (kbId: string) => {
    await api.delete(`/ai/kbs/${kbId}`);
    setKnowledgeBases((prev) => prev.filter((kb) => kb.id !== kbId));
  }, []);

  // ── Entries (scoped under a KB) ──

  const fetchKBEntries = useCallback(async (kbId: string): Promise<KBEntry[]> => {
    const { data } = await api.get(`/ai/kbs/${kbId}/entries`);
    return data.entries;
  }, []);

  const addKBEntry = useCallback(
    async (kbId: string, entry: { title: string; content: string }) => {
      const { data } = await api.post(`/ai/kbs/${kbId}/entries`, entry);
      setKnowledgeBases((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, entry_count: kb.entry_count + 1 } : kb))
      );
      return data.entry as KBEntry;
    },
    []
  );

  const uploadKBFile = useCallback(
    async (kbId: string, file: File, title?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);

      const { data } = await api.post(`/ai/kbs/${kbId}/entries/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setKnowledgeBases((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, entry_count: kb.entry_count + 1 } : kb))
      );
      return data.entry as KBEntry;
    },
    []
  );

  const uploadKBFileStream = useCallback(
    async (
      kbId: string,
      file: File,
      title: string | undefined,
      onEvent: (event: { step: string; status: string; data?: Record<string, unknown>; error?: string; timestamp: number }) => void
    ) => {
      const formData = new FormData();
      formData.append('file', file);
      if (title) formData.append('title', title);

      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${api.defaults.baseURL}/ai/kbs/${kbId}/entries/upload/stream`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok || !response.body) {
        throw new Error('Stream upload failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalEntry: KBEntry | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
              if (event.step === 'complete' && event.data?.entry) {
                finalEntry = event.data.entry as KBEntry;
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }

      if (finalEntry) {
        setKnowledgeBases((prev) =>
          prev.map((kb) => (kb.id === kbId ? { ...kb, entry_count: kb.entry_count + 1 } : kb))
        );
      }
      return finalEntry;
    },
    []
  );

  const addKBEntryStream = useCallback(
    async (
      kbId: string,
      title: string,
      content: string,
      onEvent: (event: { step: string; status: string; data?: Record<string, unknown>; error?: string; timestamp: number }) => void
    ) => {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${api.defaults.baseURL}/ai/kbs/${kbId}/entries/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title, content }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Stream add failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalEntry: KBEntry | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
              if (event.step === 'complete' && event.data?.entry) {
                finalEntry = event.data.entry as KBEntry;
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      }

      if (finalEntry) {
        setKnowledgeBases((prev) =>
          prev.map((kb) => (kb.id === kbId ? { ...kb, entry_count: kb.entry_count + 1 } : kb))
        );
      }
      return finalEntry;
    },
    []
  );

  const updateKBEntry = useCallback(
    async (kbId: string, entryId: string, updates: { title?: string; content?: string }) => {
      const { data } = await api.put(`/ai/kbs/${kbId}/entries/${entryId}`, updates);
      return data.entry as KBEntry;
    },
    []
  );

  const deleteKBEntry = useCallback(
    async (kbId: string, entryId: string) => {
      await api.delete(`/ai/kbs/${kbId}/entries/${entryId}`);
      setKnowledgeBases((prev) =>
        prev.map((kb) => (kb.id === kbId ? { ...kb, entry_count: Math.max(0, kb.entry_count - 1) } : kb))
      );
    },
    []
  );

  // ── Chunks & Search ──

  const fetchEntryChunks = useCallback(
    async (kbId: string, entryId: string): Promise<KBChunk[]> => {
      const { data } = await api.get(`/ai/kbs/${kbId}/entries/${entryId}/chunks`);
      return data.chunks;
    },
    []
  );

  const updateChunk = useCallback(
    async (kbId: string, entryId: string, chunkId: string, content: string): Promise<{ chunk: KBChunk; reembedded: boolean }> => {
      const { data } = await api.put(`/ai/kbs/${kbId}/entries/${entryId}/chunks/${chunkId}`, { content });
      return { chunk: data.chunk, reembedded: data.reembedded };
    },
    []
  );

  const deleteChunk = useCallback(
    async (kbId: string, entryId: string, chunkId: string): Promise<{ remainingChunks: number }> => {
      const { data } = await api.delete(`/ai/kbs/${kbId}/entries/${entryId}/chunks/${chunkId}`);
      return { remainingChunks: data.remainingChunks };
    },
    []
  );

  const reembedEntry = useCallback(
    async (kbId: string, entryId: string) => {
      await api.post(`/ai/kbs/${kbId}/entries/${entryId}/reembed`);
    },
    []
  );

  const searchKB = useCallback(
    async (query: string, knowledgeBaseIds?: string[]): Promise<{ results: KBSearchResult[]; queryClassification?: { method: string; reasoning: string } }> => {
      const { data } = await api.post('/ai/kb/search', {
        query,
        knowledge_base_ids: knowledgeBaseIds,
      });
      return { results: data.results, queryClassification: data.queryClassification };
    },
    []
  );

  return {
    knowledgeBases,
    loading,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    fetchKBEntries,
    addKBEntry,
    uploadKBFile,
    uploadKBFileStream,
    addKBEntryStream,
    updateKBEntry,
    deleteKBEntry,
    fetchEntryChunks,
    updateChunk,
    deleteChunk,
    reembedEntry,
    searchKB,
    refetch: fetchKnowledgeBases,
  };
}
