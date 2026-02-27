-- ============================================================
-- Reply Flow — AI Activity Schedule Migration
-- Adds schedule_mode, ai_schedule, and outside_hours_message
-- to workspace_ai_profiles for time-based AI availability.
-- ============================================================

-- 1. Schedule mode: always_on | business_hours | custom
ALTER TABLE public.workspace_ai_profiles
  ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'always_on';

ALTER TABLE public.workspace_ai_profiles
  ADD CONSTRAINT workspace_ai_profiles_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom'));

-- 2. Custom AI schedule (same shape as workspaces.business_hours)
ALTER TABLE public.workspace_ai_profiles
  ADD COLUMN IF NOT EXISTS ai_schedule JSONB DEFAULT NULL;

-- 3. Message sent when AI is inactive
ALTER TABLE public.workspace_ai_profiles
  ADD COLUMN IF NOT EXISTS outside_hours_message TEXT DEFAULT NULL;
