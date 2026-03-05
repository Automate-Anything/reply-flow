-- Migration 029: Custom conversation statuses
-- Replaces hardcoded status values with a configurable per-company statuses table.

-- 1. Create conversation_statuses table
CREATE TABLE IF NOT EXISTS public.conversation_statuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  "group"     TEXT NOT NULL CHECK ("group" IN ('open', 'closed')),
  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unique name per company (only among non-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_statuses_name
  ON public.conversation_statuses(company_id, name) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_conversation_statuses_company
  ON public.conversation_statuses(company_id) WHERE is_deleted = false;

-- 2. Enable RLS
ALTER TABLE public.conversation_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversation_statuses_company_access" ON public.conversation_statuses
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

-- 3. Seed default statuses for all existing companies
INSERT INTO public.conversation_statuses (company_id, name, color, "group", sort_order, is_default)
SELECT id, 'open',     '#22C55E', 'open',   0, TRUE  FROM public.companies
UNION ALL
SELECT id, 'pending',  '#EAB308', 'open',   1, FALSE FROM public.companies
UNION ALL
SELECT id, 'resolved', '#3B82F6', 'closed', 0, FALSE FROM public.companies
UNION ALL
SELECT id, 'closed',   '#6B7280', 'closed', 1, FALSE FROM public.companies;

-- 4. Drop the hardcoded CHECK constraint on chat_sessions.status
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_status_check;
