-- Add scheduled_for column for schedule-send feature
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_messages_scheduled
  ON public.chat_messages(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status = 'scheduled';
