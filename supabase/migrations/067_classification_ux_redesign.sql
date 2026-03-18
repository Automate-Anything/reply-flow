-- 067_classification_ux_redesign.sql
-- Move classification config from ai_agents.profile_data to company + channel level

-- 1. New columns on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_rules TEXT,
  ADD COLUMN IF NOT EXISTS classification_auto_classify BOOLEAN NOT NULL DEFAULT false;

-- 2. New columns on channel_agent_settings
ALTER TABLE channel_agent_settings
  ADD COLUMN IF NOT EXISTS classification_override TEXT NOT NULL DEFAULT 'company_defaults'
    CHECK (classification_override IN ('company_defaults', 'custom', 'disabled')),
  ADD COLUMN IF NOT EXISTS classification_mode TEXT
    CHECK (classification_mode IS NULL OR classification_mode IN ('suggest', 'auto_apply')),
  ADD COLUMN IF NOT EXISTS classification_auto_classify BOOLEAN,
  ADD COLUMN IF NOT EXISTS classification_rules TEXT;

-- 3. Add 'classification' notification type
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'share', 'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note', 'handoff',
    'group_criteria_match', 'classification'
  ));

-- 4. Update notification_preferences default to include classification
ALTER TABLE notification_preferences
  ALTER COLUMN preferences SET DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true,
    "handoff": true,
    "group_criteria_match": true,
    "classification": true
  }'::jsonb;

-- 5. Backfill existing notification_preferences rows with classification default
UPDATE notification_preferences
  SET preferences = preferences || '{"classification": true}'::jsonb
  WHERE NOT (preferences ? 'classification');

-- 6. Data migration: move config from ai_agents.profile_data.classification
-- For channels with agents that had classification enabled: set custom override
-- For channels with agents that had classification disabled or missing: set disabled
-- This ensures no channel gains classification that didn't have it before
DO $$
DECLARE
  r RECORD;
  agent_classification JSONB;
BEGIN
  FOR r IN
    SELECT cas.id AS cas_id, cas.agent_id, cas.company_id, a.profile_data
    FROM channel_agent_settings cas
    JOIN ai_agents a ON a.id = cas.agent_id
    WHERE cas.agent_id IS NOT NULL
  LOOP
    agent_classification := r.profile_data -> 'classification';

    IF agent_classification IS NOT NULL AND (agent_classification ->> 'enabled')::boolean = true THEN
      -- Channel had classification enabled via agent — migrate to custom
      UPDATE channel_agent_settings SET
        classification_override = 'custom',
        classification_auto_classify = COALESCE((agent_classification ->> 'auto_classify_new')::boolean, false),
        classification_rules = agent_classification ->> 'rules'
      WHERE id = r.cas_id;

      -- Enable company-level classification for this company
      UPDATE companies SET classification_enabled = true WHERE id = r.company_id;
    ELSE
      -- Channel did NOT have classification — set disabled to preserve behavior
      UPDATE channel_agent_settings SET classification_override = 'disabled'
      WHERE id = r.cas_id;
    END IF;
  END LOOP;
END $$;
