-- Auto-assign rules: one per channel (or company-wide if channel_id is null)
CREATE TABLE auto_assign_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id BIGINT REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL CHECK (strategy IN ('round_robin', 'least_busy', 'tag_based')),
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, channel_id)
);

-- For company-wide rule (channel_id = null), need partial unique index
CREATE UNIQUE INDEX idx_auto_assign_rules_company_default
  ON auto_assign_rules (company_id)
  WHERE channel_id IS NULL;

-- Member pool: who can be auto-assigned per rule
CREATE TABLE auto_assign_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES auto_assign_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  last_assigned_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, user_id)
);

-- Indexes
CREATE INDEX idx_auto_assign_rules_company ON auto_assign_rules (company_id);
CREATE INDEX idx_auto_assign_rules_channel ON auto_assign_rules (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX idx_auto_assign_members_rule ON auto_assign_members (rule_id);
CREATE INDEX idx_auto_assign_members_user ON auto_assign_members (user_id);
CREATE INDEX idx_auto_assign_members_available ON auto_assign_members (rule_id, is_available, last_assigned_at)
  WHERE is_available = true;

-- RLS
ALTER TABLE auto_assign_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_assign_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY auto_assign_rules_select ON auto_assign_rules FOR SELECT USING (
  company_id = public.get_user_company_id()
);
CREATE POLICY auto_assign_rules_insert ON auto_assign_rules FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);
CREATE POLICY auto_assign_rules_update ON auto_assign_rules FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);
CREATE POLICY auto_assign_rules_delete ON auto_assign_rules FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);

CREATE POLICY auto_assign_members_select ON auto_assign_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM auto_assign_rules r
    WHERE r.id = auto_assign_members.rule_id
    AND r.company_id = public.get_user_company_id()
  )
);
CREATE POLICY auto_assign_members_all ON auto_assign_members FOR ALL USING (
  EXISTS (
    SELECT 1 FROM auto_assign_rules r
    WHERE r.id = auto_assign_members.rule_id
    AND r.company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'edit')
  )
);

-- No new permission needed — we reuse channels.edit for managing auto-assign rules
