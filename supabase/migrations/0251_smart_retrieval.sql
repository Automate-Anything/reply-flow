-- ============================================================
-- MIGRATION 025: SMART RETRIEVAL
-- Adds vector-only and FTS-only search functions, and updates
-- hybrid_search with configurable vector/FTS weights.
-- ============================================================

-- ============================================================
-- STEP 1: VECTOR-ONLY SEARCH
-- Fast semantic search when query is conceptual/meaning-based.
-- Skips FTS entirely for lower latency.
-- ============================================================
CREATE OR REPLACE FUNCTION public.vector_search(
  p_query_embedding vector(1536),
  p_company_id UUID,
  p_knowledge_base_ids UUID[] DEFAULT NULL,
  p_match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  entry_id UUID,
  knowledge_base_id UUID,
  chunk_index INTEGER,
  content TEXT,
  metadata JSONB,
  similarity DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.entry_id,
    c.knowledge_base_id,
    c.chunk_index,
    c.content,
    c.metadata,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.kb_chunks c
  WHERE c.company_id = p_company_id
    AND c.embedding IS NOT NULL
    AND (p_knowledge_base_ids IS NULL OR c.knowledge_base_id = ANY(p_knowledge_base_ids))
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- ============================================================
-- STEP 2: FTS-ONLY SEARCH
-- Fast keyword search when query targets exact terms/IDs.
-- No embedding generation needed — much faster.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fts_search(
  p_query_text TEXT,
  p_company_id UUID,
  p_knowledge_base_ids UUID[] DEFAULT NULL,
  p_match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  entry_id UUID,
  knowledge_base_id UUID,
  chunk_index INTEGER,
  content TEXT,
  metadata JSONB,
  fts_rank REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.entry_id,
    c.knowledge_base_id,
    c.chunk_index,
    c.content,
    c.metadata,
    ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query_text)) AS fts_rank
  FROM public.kb_chunks c
  WHERE c.company_id = p_company_id
    AND c.fts @@ websearch_to_tsquery('english', p_query_text)
    AND (p_knowledge_base_ids IS NULL OR c.knowledge_base_id = ANY(p_knowledge_base_ids))
  ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query_text)) DESC
  LIMIT p_match_count;
$$;

-- ============================================================
-- STEP 3: UPDATE HYBRID SEARCH WITH CONFIGURABLE WEIGHTS
-- Adds p_vector_weight and p_fts_weight to let the query
-- classifier bias RRF toward vector or FTS as needed.
-- Default weights of 1.0 preserve existing behavior.
-- ============================================================
CREATE OR REPLACE FUNCTION public.hybrid_search(
  p_query_embedding vector(1536),
  p_query_text TEXT,
  p_company_id UUID,
  p_knowledge_base_ids UUID[] DEFAULT NULL,
  p_match_count INTEGER DEFAULT 5,
  p_rrf_k INTEGER DEFAULT 60,
  p_vector_weight DOUBLE PRECISION DEFAULT 1.0,
  p_fts_weight DOUBLE PRECISION DEFAULT 1.0
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
      (p_vector_weight / (p_rrf_k + COALESCE(v.rank, p_match_count * 4 + 1))) +
      (p_fts_weight / (p_rrf_k + COALESCE(f.rank, p_match_count * 4 + 1))) AS score
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
