-- ============================================================
-- MIGRATION 031: CONTACT MEMORIES
-- Stores AI-extracted memories from ended sessions so that
-- future sessions have context about returning contacts.
-- Uses vector embeddings for semantic search (same infra as KB).
-- ============================================================

-- 1. Contact memories table
CREATE TABLE IF NOT EXISTS public.contact_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  memory_type     TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'decision', 'issue', 'summary')),
  content         TEXT NOT NULL,
  embedding       vector(1536),
  metadata        JSONB DEFAULT '{}',
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_contact_memories_contact
  ON public.contact_memories(contact_id, company_id);

CREATE INDEX IF NOT EXISTS idx_contact_memories_session
  ON public.contact_memories(session_id);

CREATE INDEX IF NOT EXISTS idx_contact_memories_embedding
  ON public.contact_memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. RPC: Semantic search over a contact's memories
CREATE OR REPLACE FUNCTION public.search_contact_memories(
  p_query_embedding vector(1536),
  p_contact_id UUID,
  p_company_id UUID,
  p_match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  memory_type TEXT,
  content TEXT,
  metadata JSONB,
  similarity DOUBLE PRECISION,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    cm.id,
    cm.session_id,
    cm.memory_type,
    cm.content,
    cm.metadata,
    1 - (cm.embedding <=> p_query_embedding) AS similarity,
    cm.created_at
  FROM public.contact_memories cm
  WHERE cm.contact_id = p_contact_id
    AND cm.company_id = p_company_id
    AND cm.is_active = true
    AND cm.embedding IS NOT NULL
  ORDER BY cm.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- 4. RLS — company-scoped access
ALTER TABLE public.contact_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read contact memories"
  ON public.contact_memories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = contact_memories.company_id
        AND cm.user_id = auth.uid()
    )
  );
