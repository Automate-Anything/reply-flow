-- Add optional instructions column to channel KB assignments
ALTER TABLE public.channel_kb_assignments
  ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT NULL;
