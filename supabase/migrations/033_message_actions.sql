-- Message-level actions: star, pin, reactions

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '[]';

-- Partial indexes for efficient filtering
CREATE INDEX idx_chat_messages_starred
  ON public.chat_messages(session_id)
  WHERE is_starred = true;

CREATE INDEX idx_chat_messages_pinned
  ON public.chat_messages(session_id)
  WHERE is_pinned = true;
