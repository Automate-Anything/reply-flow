-- Migration 028: Unify contact_notes and conversation_notes
-- Adds contact_id to conversation_notes, migrates existing contact_notes data,
-- and makes session_id nullable so notes can exist for contacts without conversations.

-- 1. Add contact_id column to conversation_notes
ALTER TABLE public.conversation_notes
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id);

-- 2. Make session_id nullable (notes from contacts page may not have a session)
ALTER TABLE public.conversation_notes
  ALTER COLUMN session_id DROP NOT NULL;

-- 3. Backfill contact_id on existing conversation_notes via chat_sessions.contact_id
UPDATE public.conversation_notes cn
SET contact_id = cs.contact_id
FROM public.chat_sessions cs
WHERE cn.session_id = cs.id
  AND cs.contact_id IS NOT NULL
  AND cn.contact_id IS NULL;

-- 4. Migrate contact_notes into conversation_notes
INSERT INTO public.conversation_notes (id, session_id, company_id, contact_id, content, created_by, is_deleted, created_at, updated_at)
SELECT
  cn.id,
  cs.id AS session_id,
  cn.company_id,
  cn.contact_id,
  cn.content,
  cn.created_by,
  cn.is_deleted,
  cn.created_at,
  cn.updated_at
FROM public.contact_notes cn
LEFT JOIN public.chat_sessions cs
  ON cs.contact_id = cn.contact_id
  AND cs.company_id = cn.company_id
ON CONFLICT (id) DO NOTHING;

-- 5. Index for contact_id lookups
CREATE INDEX IF NOT EXISTS idx_conversation_notes_contact
  ON public.conversation_notes(contact_id)
  WHERE contact_id IS NOT NULL AND is_deleted = false;
