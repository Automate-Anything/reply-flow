-- ============================================================
-- MIGRATION 019: RAG EMBEDDINGS & HYBRID SEARCH
-- Adds vector search infrastructure for knowledge base entries.
-- Creates kb_chunks table with embeddings and full-text search.
-- Enables hybrid search (vector + keyword) with RRF fusion.
-- ============================================================

-- ============================================================
-- STEP 1: ENABLE pgvector EXTENSION
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================================
-- STEP 2: CREATE kb_chunks TABLE
-- Stores pre-chunked, embedded document fragments for RAG.
-- Denormalizes company_id and knowledge_base_id for fast filtering.
-- ============================================================
CREATE TABLE public.kb_chunks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          UUID NOT NULL REFERENCES public.knowledge_base_entries(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chunk_index       INTEGER NOT NULL,
  content           TEXT NOT NULL,
  embedding         vector(1536),
  fts               tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.kb_chunks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- STEP 3: INDEXES
-- ============================================================

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX idx_kb_chunks_embedding ON public.kb_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for fast full-text search
CREATE INDEX idx_kb_chunks_fts ON public.kb_chunks USING gin (fts);

-- B-tree indexes for filtering
CREATE INDEX idx_kb_chunks_company ON public.kb_chunks(company_id);
CREATE INDEX idx_kb_chunks_entry ON public.kb_chunks(entry_id);
CREATE INDEX idx_kb_chunks_kb ON public.kb_chunks(knowledge_base_id);

-- Composite index for common query pattern: company + kb filtering
CREATE INDEX idx_kb_chunks_company_kb ON public.kb_chunks(company_id, knowledge_base_id);

-- ============================================================
-- STEP 4: RLS POLICIES (mirrors knowledge_base_entries)
-- ============================================================
CREATE POLICY "Company members can view kb chunks"
  ON public.kb_chunks FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'view')
  );

CREATE POLICY "Authorized users can create kb chunks"
  ON public.kb_chunks FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'create')
  );

CREATE POLICY "Authorized users can update kb chunks"
  ON public.kb_chunks FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'edit')
  );

CREATE POLICY "Authorized users can delete kb chunks"
  ON public.kb_chunks FOR DELETE
  USING (
    company_id = public.get_user_company_id()
    AND public.has_permission('knowledge_base', 'delete')
  );

-- ============================================================
-- STEP 5: HYBRID SEARCH RPC FUNCTION
-- Combines vector similarity search with full-text keyword search
-- using Reciprocal Rank Fusion (RRF) for result merging.
-- ============================================================
CREATE OR REPLACE FUNCTION public.hybrid_search(
  p_query_embedding vector(1536),
  p_query_text TEXT,
  p_company_id UUID,
  p_knowledge_base_ids UUID[] DEFAULT NULL,
  p_match_count INTEGER DEFAULT 5,
  p_rrf_k INTEGER DEFAULT 60
)
RETURNS TABLE (
  id UUID,
  entry_id UUID,
  knowledge_base_id UUID,
  chunk_index INTEGER,
  content TEXT,
  metadata JSONB,
  vector_rank BIGINT,
  fts_rank BIGINT,
  rrf_score DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
  WITH vector_search AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> p_query_embedding) AS rank
    FROM public.kb_chunks c
    WHERE c.company_id = p_company_id
      AND c.embedding IS NOT NULL
      AND (p_knowledge_base_ids IS NULL OR c.knowledge_base_id = ANY(p_knowledge_base_ids))
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_match_count * 4
  ),
  fts_search AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query_text)) DESC
      ) AS rank
    FROM public.kb_chunks c
    WHERE c.company_id = p_company_id
      AND c.fts @@ websearch_to_tsquery('english', p_query_text)
      AND (p_knowledge_base_ids IS NULL OR c.knowledge_base_id = ANY(p_knowledge_base_ids))
    ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query_text)) DESC
    LIMIT p_match_count * 4
  ),
  combined AS (
    SELECT
      COALESCE(v.id, f.id) AS chunk_id,
      COALESCE(v.rank, (p_match_count * 4 + 1)::bigint) AS v_rank,
      COALESCE(f.rank, (p_match_count * 4 + 1)::bigint) AS f_rank,
      (1.0 / (p_rrf_k + COALESCE(v.rank, p_match_count * 4 + 1))) +
      (1.0 / (p_rrf_k + COALESCE(f.rank, p_match_count * 4 + 1))) AS score
    FROM vector_search v
    FULL OUTER JOIN fts_search f ON v.id = f.id
  )
  SELECT
    c.id,
    c.entry_id,
    c.knowledge_base_id,
    c.chunk_index,
    c.content,
    c.metadata,
    comb.v_rank AS vector_rank,
    comb.f_rank AS fts_rank,
    comb.score AS rrf_score
  FROM combined comb
  JOIN public.kb_chunks c ON c.id = comb.chunk_id
  ORDER BY comb.score DESC
  LIMIT p_match_count;
$$;

-- ============================================================
-- STEP 6: ADD embedding_status TO knowledge_base_entries
-- Tracks which entries have been successfully chunked and embedded.
-- ============================================================
ALTER TABLE public.knowledge_base_entries
  ADD COLUMN embedding_status TEXT DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed'));

-- Mark all existing entries as needing embedding.
-- Actual backfill is done server-side via POST /api/ai/backfill-embeddings.
UPDATE public.knowledge_base_entries
  SET embedding_status = 'pending'
  WHERE embedding_status IS NULL;
