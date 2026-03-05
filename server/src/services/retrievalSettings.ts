/**
 * Retrieval Settings — runtime-configurable constants for chunking & search.
 * Values stored in `retrieval_settings` table, cached with 60s TTL.
 */

import { supabaseAdmin } from '../config/supabase.js';

// ── Types ──────────────────────────────────────────

export interface RetrievalSettings {
  matchCount: number;
  maxChunkSize: number;
  chunkTargetSize: number;
  chunkOverlap: number;
  minChunkSize: number;
  similarityThreshold: number;
  ftsThreshold: number;
  rrfThreshold: number;
}

// ── Hardcoded Defaults (fallback if DB unavailable) ──

const DEFAULTS: RetrievalSettings = {
  matchCount: 5,
  maxChunkSize: 3000,
  chunkTargetSize: 2000,
  chunkOverlap: 200,
  minChunkSize: 100,
  similarityThreshold: 0.25,
  ftsThreshold: 0.01,
  rrfThreshold: 0.005,
};

// ── Key → Field Mapping ──────────────────────────

const KEY_MAP: Record<string, keyof RetrievalSettings> = {
  match_count: 'matchCount',
  max_chunk_size: 'maxChunkSize',
  chunk_target_size: 'chunkTargetSize',
  chunk_overlap: 'chunkOverlap',
  min_chunk_size: 'minChunkSize',
  similarity_threshold: 'similarityThreshold',
  fts_threshold: 'ftsThreshold',
  rrf_threshold: 'rrfThreshold',
};

// ── Cache ────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
let cached: RetrievalSettings | null = null;
let cacheTime = 0;

export function invalidateRetrievalSettingsCache(): void {
  cached = null;
  cacheTime = 0;
}

export async function getRetrievalSettings(): Promise<RetrievalSettings> {
  const now = Date.now();
  if (cached && now - cacheTime < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('retrieval_settings')
      .select('key, value');

    if (error) throw error;

    const settings = { ...DEFAULTS };

    for (const row of data || []) {
      const field = KEY_MAP[row.key];
      if (field) {
        const parsed = parseFloat(row.value);
        if (!isNaN(parsed) && parsed > 0) {
          (settings[field] as number) = parsed;
        }
      }
    }

    cached = settings;
    cacheTime = now;
    return settings;
  } catch (err) {
    console.warn('Failed to load retrieval settings, using defaults:', err);
    return DEFAULTS;
  }
}
