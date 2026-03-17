import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

type SuggestionMode = 'generate' | 'complete' | 'rewrite';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface LastRequest {
  sessionId: string;
  existingText: string;
  mode: SuggestionMode;
}

export function useAISuggestion() {
  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestionsToday, setSuggestionsToday] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<LastRequest | null>(null);

  const suggest = useCallback(
    async (sessionId: string, existingText: string, mode: SuggestionMode) => {
      // Abort any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      // Store for regenerate
      lastRequestRef.current = { sessionId, existingText, mode };

      setIsStreaming(true);
      setError(null);
      setStreamedText('');

      try {
        // Get auth token from Supabase (same source as Axios interceptor in api.ts)
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch(`${API_URL}/api/ai/suggest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId, mode, existingText: existingText || undefined }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed (${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);

              if (data.token) {
                setStreamedText((prev) => prev + data.token);
              }

              if (data.done) {
                setSuggestionsToday(data.suggestionsToday ?? 0);
              }

              if (data.error) {
                setError(data.error);
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User stopped — not an error, keep whatever was streamed
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to generate suggestion');
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const regenerate = useCallback(() => {
    const last = lastRequestRef.current;
    if (!last) return;
    suggest(last.sessionId, last.existingText, last.mode);
  }, [suggest]);

  /** Call when the user manually edits text after a suggestion — clears regenerate state */
  const clearSuggestion = useCallback(() => {
    setStreamedText('');
    lastRequestRef.current = null;
  }, []);

  return {
    suggest,
    stop,
    regenerate,
    streamedText,
    setStreamedText,
    clearSuggestion,
    isStreaming,
    suggestionsToday,
    error,
  };
}
