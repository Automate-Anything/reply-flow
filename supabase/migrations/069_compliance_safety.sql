-- compliance_metrics: stores all compliance events for dashboard
CREATE TABLE compliance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_compliance_metrics_channel ON compliance_metrics(channel_id, created_at);
CREATE INDEX idx_compliance_metrics_company ON compliance_metrics(company_id, created_at);

-- channel_safety_scores: cached WhAPI safety meter results (max 1 refresh/day)
CREATE TABLE channel_safety_scores (
  channel_id BIGINT PRIMARY KEY REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  risk_factor INTEGER,
  risk_factor_chats INTEGER,
  risk_factor_contacts INTEGER,
  life_time INTEGER,
  fetched_at TIMESTAMPTZ
);
CREATE INDEX idx_safety_scores_company ON channel_safety_scores(company_id);

-- Auto-reply message variants (array of 3-5 alternatives)
ALTER TABLE channel_agent_settings
  ADD COLUMN IF NOT EXISTS auto_reply_messages TEXT[] DEFAULT '{}';

-- Atomic claim function for scheduled message processing
-- Uses FOR UPDATE SKIP LOCKED to prevent duplicate sends
CREATE OR REPLACE FUNCTION claim_scheduled_messages(batch_size INT DEFAULT 5)
RETURNS SETOF chat_messages AS $$
  UPDATE chat_messages
  SET status = 'sending'
  WHERE id IN (
    SELECT id FROM chat_messages
    WHERE status = 'scheduled' AND scheduled_for <= NOW()
    ORDER BY scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

-- RLS policies for compliance_metrics
ALTER TABLE compliance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_metrics_select"
  ON compliance_metrics FOR SELECT
  USING (company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1));

CREATE POLICY "compliance_metrics_insert"
  ON compliance_metrics FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1));

-- RLS policies for channel_safety_scores
ALTER TABLE channel_safety_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_safety_scores_select"
  ON channel_safety_scores FOR SELECT
  USING (company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1));

CREATE POLICY "channel_safety_scores_upsert"
  ON channel_safety_scores FOR ALL
  USING (company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1));
