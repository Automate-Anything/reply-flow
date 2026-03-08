-- ============================================================
-- MIGRATION 034: RETRIEVAL SETTINGS
-- Stores configurable retrieval parameters (chunk sizes,
-- search thresholds, match counts) editable via super admin.
-- ============================================================

CREATE TABLE public.retrieval_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.retrieval_settings ENABLE ROW LEVEL SECURITY;

-- Seed defaults (match current hardcoded values)
INSERT INTO public.retrieval_settings (key, value, label, description) VALUES
  ('match_count',          '5',     'Match Count',          'Number of chunks returned per search query'),
  ('max_chunk_size',       '3000',  'Max Chunk Size',       'Maximum characters per chunk (safety cap)'),
  ('chunk_target_size',    '2000',  'Chunk Target Size',    'Target size for size-based splitting'),
  ('chunk_overlap',        '200',   'Chunk Overlap',        'Character overlap between split chunks'),
  ('min_chunk_size',       '100',   'Min Chunk Size',       'Skip chunks smaller than this'),
  ('similarity_threshold', '0.25',  'Similarity Threshold', 'Cosine similarity floor for vector search (0-1)'),
  ('fts_threshold',        '0.01',  'FTS Threshold',        'Full-text search rank floor'),
  ('rrf_threshold',        '0.005', 'RRF Threshold',        'Hybrid search RRF score floor');
