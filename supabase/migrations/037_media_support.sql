-- Migration: Media support for WhatsApp messages
-- Adds storage bucket for chat media and columns for media file paths + AI-extracted content

-- 1. Create private storage bucket for chat media
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow service role full access (server-side only, no client RLS needed)
DROP POLICY IF EXISTS "Service role full access on chat-media" ON storage.objects;
CREATE POLICY "Service role full access on chat-media"
  ON storage.objects FOR ALL
  USING (bucket_id = 'chat-media')
  WITH CHECK (bucket_id = 'chat-media');

-- 3. Add media columns to chat_messages
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS media_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_transcript TEXT,
  ADD COLUMN IF NOT EXISTS media_extracted_text TEXT;

-- 4. Index for finding messages with pending media processing
CREATE INDEX IF NOT EXISTS idx_chat_messages_media_path
  ON chat_messages (media_storage_path)
  WHERE media_storage_path IS NOT NULL;
