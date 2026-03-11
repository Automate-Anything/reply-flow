-- Company-managed conversation priorities

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_priority_check;

UPDATE public.chat_sessions
SET priority = CASE priority
  WHEN 'urgent' THEN 'Urgent'
  WHEN 'high' THEN 'High'
  WHEN 'medium' THEN 'Medium'
  WHEN 'low' THEN 'Low'
  WHEN 'none' THEN 'None'
  ELSE priority
END;

CREATE TABLE IF NOT EXISTS public.conversation_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, name)
);

ALTER TABLE public.conversation_priorities ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversation_priorities_company
  ON public.conversation_priorities(company_id, is_deleted, sort_order);

DROP TRIGGER IF EXISTS set_updated_at_conversation_priorities ON public.conversation_priorities;
CREATE TRIGGER set_updated_at_conversation_priorities
  BEFORE UPDATE ON public.conversation_priorities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP POLICY IF EXISTS "Company members can view conversation priorities" ON public.conversation_priorities;
CREATE POLICY "Company members can view conversation priorities"
  ON public.conversation_priorities FOR SELECT
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "Authorized users can create conversation priorities" ON public.conversation_priorities;
CREATE POLICY "Authorized users can create conversation priorities"
  ON public.conversation_priorities FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "Authorized users can update conversation priorities" ON public.conversation_priorities;
CREATE POLICY "Authorized users can update conversation priorities"
  ON public.conversation_priorities FOR UPDATE
  USING (company_id = public.get_user_company_id());

DROP POLICY IF EXISTS "Authorized users can delete conversation priorities" ON public.conversation_priorities;
CREATE POLICY "Authorized users can delete conversation priorities"
  ON public.conversation_priorities FOR DELETE
  USING (company_id = public.get_user_company_id());

INSERT INTO public.conversation_priorities (company_id, name, color, sort_order, is_default)
SELECT c.id, priority.name, priority.color, priority.sort_order, priority.is_default
FROM public.companies c
CROSS JOIN (
  VALUES
    ('Urgent', '#EF4444', 0, FALSE),
    ('High', '#F97316', 1, FALSE),
    ('Medium', '#EAB308', 2, FALSE),
    ('Low', '#3B82F6', 3, FALSE),
    ('None', '#9CA3AF', 4, TRUE)
) AS priority(name, color, sort_order, is_default)
ON CONFLICT (company_id, name) DO NOTHING;
