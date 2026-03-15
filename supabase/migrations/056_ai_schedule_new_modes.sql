-- Expand schedule_mode CHECK constraint to include 'when_away' and 'outside_hours' modes
-- when_away: AI responds only when ALL team members are set to Away
-- outside_hours: AI responds only OUTSIDE business hours (inverse of business_hours)

-- channel_agent_settings
ALTER TABLE channel_agent_settings
  DROP CONSTRAINT IF EXISTS channel_agent_settings_schedule_mode_check;

ALTER TABLE channel_agent_settings
  ADD CONSTRAINT channel_agent_settings_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom', 'when_away', 'outside_hours'));

-- company_ai_profiles (constraint has legacy name from workspace era)
ALTER TABLE company_ai_profiles
  DROP CONSTRAINT IF EXISTS workspace_ai_profiles_schedule_mode_check;

ALTER TABLE company_ai_profiles
  ADD CONSTRAINT company_ai_profiles_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom', 'when_away', 'outside_hours'));
