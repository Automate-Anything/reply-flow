-- 006: Add timezone to companies, default_language + business_hours to workspaces

-- Company timezone
ALTER TABLE public.companies ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

-- Workspace default language and business hours
ALTER TABLE public.workspaces
  ADD COLUMN default_language TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN business_hours JSONB DEFAULT NULL;
