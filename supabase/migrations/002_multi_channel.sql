-- ============================================================
-- Multi-Channel Support Migration
-- Allows users to have multiple WhatsApp channels
-- ============================================================

-- 1. Drop the one-channel-per-user constraint
ALTER TABLE public.whatsapp_channels DROP CONSTRAINT whatsapp_channels_user_id_key;

-- 2. Add channel_id to chat_sessions (ON DELETE SET NULL preserves conversation history)
ALTER TABLE public.chat_sessions
  ADD COLUMN channel_id BIGINT REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL;

-- 3. Backfill existing sessions with their user's channel
UPDATE public.chat_sessions cs
SET channel_id = (
  SELECT wc.id FROM public.whatsapp_channels wc
  WHERE wc.user_id = cs.user_id
  LIMIT 1
)
WHERE cs.channel_id IS NULL;

-- 4. Update unique constraint: same contact can message different channels
ALTER TABLE public.chat_sessions DROP CONSTRAINT chat_sessions_user_id_chat_id_key;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_channel_id_chat_id_key UNIQUE(channel_id, chat_id);

-- 5. Add indexes for performance
CREATE INDEX idx_chat_sessions_channel ON public.chat_sessions(channel_id);
CREATE INDEX idx_whatsapp_channels_phone ON public.whatsapp_channels(phone_number) WHERE channel_status = 'connected';
