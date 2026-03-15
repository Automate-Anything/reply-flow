-- Add personal schedule columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS personal_hours JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hours_control_availability BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_override_until TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN users.timezone IS 'IANA timezone override for this user. NULL means use the company timezone.';
COMMENT ON COLUMN users.personal_hours IS 'Weekly working hours schedule for this user (same shape as companies.business_hours). NULL means use the company schedule.';
COMMENT ON COLUMN users.hours_control_availability IS 'When true, the user''s availability status is automatically managed based on their working hours and holidays.';
COMMENT ON COLUMN users.availability_override_until IS 'When set, the auto-managed availability is paused until this timestamp (manual override window).';

-- Holidays table: company-wide or per-user
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('company', 'user')),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- company-scoped holidays must not have a user_id; user-scoped must have one
  CONSTRAINT holidays_scope_user_id_check CHECK (
    (scope = 'company' AND user_id IS NULL) OR
    (scope = 'user'    AND user_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX idx_holidays_company ON holidays (company_id);
CREATE INDEX idx_holidays_user    ON holidays (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_holidays_date    ON holidays (company_id, date);

-- RLS
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY holidays_select ON holidays FOR SELECT USING (
  company_id = public.get_user_company_id()
);

CREATE POLICY holidays_insert ON holidays FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR
    (scope = 'user' AND user_id = auth.uid())
  )
);

CREATE POLICY holidays_update ON holidays FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR
    (scope = 'user' AND user_id = auth.uid())
  )
);

CREATE POLICY holidays_delete ON holidays FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR
    (scope = 'user' AND user_id = auth.uid())
  )
);
