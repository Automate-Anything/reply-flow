-- Add visibility column to labels
ALTER TABLE labels
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'
  CHECK (visibility IN ('personal', 'company'));

-- Update unique constraint: allow same name if different visibility/creator
ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_company_id_name_key;
ALTER TABLE labels ADD CONSTRAINT labels_company_visibility_unique
  UNIQUE (company_id, created_by, name);

-- Add visibility column to canned_responses
ALTER TABLE canned_responses
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'
  CHECK (visibility IN ('personal', 'company'));

-- Add unique constraint for canned_responses personal items
-- (company-wide: unique by company+title, personal: unique by creator+title)
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_visibility_unique
  UNIQUE (company_id, created_by, title);

-- Update RLS policies for labels
DROP POLICY IF EXISTS labels_select ON labels;
CREATE POLICY labels_select ON labels FOR SELECT USING (
  company_id = public.get_user_company_id()
  AND (
    visibility = 'company'
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS labels_insert ON labels;
CREATE POLICY labels_insert ON labels FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND public.has_permission('labels', 'create')
);

DROP POLICY IF EXISTS labels_update ON labels;
CREATE POLICY labels_update ON labels FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('labels', 'edit'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS labels_delete ON labels;
CREATE POLICY labels_delete ON labels FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('labels', 'delete'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

-- Update RLS policies for canned_responses
DROP POLICY IF EXISTS canned_responses_select ON canned_responses;
CREATE POLICY canned_responses_select ON canned_responses FOR SELECT USING (
  company_id = public.get_user_company_id()
  AND is_deleted = false
  AND (
    visibility = 'company'
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS canned_responses_update ON canned_responses;
CREATE POLICY canned_responses_update ON canned_responses FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('canned_responses', 'edit'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS canned_responses_delete ON canned_responses;
CREATE POLICY canned_responses_delete ON canned_responses FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('canned_responses', 'delete'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

-- Index for efficient filtering
CREATE INDEX idx_labels_visibility ON labels (company_id, visibility);
CREATE INDEX idx_canned_responses_visibility ON canned_responses (company_id, visibility) WHERE is_deleted = false;
