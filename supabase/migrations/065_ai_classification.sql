-- 065_ai_classification.sql
-- AI auto-classification: suggestions table + company classification_mode

-- 1. classification_suggestions table
CREATE TABLE IF NOT EXISTS classification_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'applied')),
  suggestions JSONB NOT NULL,
  accepted_items JSONB,
  applied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_classification_suggestions_session
  ON classification_suggestions (session_id) WHERE status = 'pending';
CREATE INDEX idx_classification_suggestions_company
  ON classification_suggestions (company_id);

-- Auto-update updated_at
CREATE TRIGGER set_classification_suggestions_updated_at
  BEFORE UPDATE ON classification_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE classification_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classification_suggestions_select"
  ON classification_suggestions FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "classification_suggestions_insert"
  ON classification_suggestions FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "classification_suggestions_update"
  ON classification_suggestions FOR UPDATE
  USING (company_id = get_user_company_id());

-- 2. Add classification_mode to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_mode TEXT NOT NULL DEFAULT 'suggest'
  CHECK (classification_mode IN ('auto_apply', 'suggest'));
