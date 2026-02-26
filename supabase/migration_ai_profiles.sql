-- ============================================================
-- Reply Flow — Per-Channel AI Profiles + Knowledge Base
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- --------------------------------------------------------
-- 1. CHANNEL AI PROFILES (replaces per-user ai_settings)
-- --------------------------------------------------------
CREATE TABLE public.channel_ai_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_enabled    BOOLEAN DEFAULT FALSE,
  profile_data  JSONB DEFAULT '{}',
  max_tokens    INTEGER DEFAULT 500,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id)
);

ALTER TABLE public.channel_ai_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ai profiles"
  ON public.channel_ai_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ai profiles"
  ON public.channel_ai_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ai profiles"
  ON public.channel_ai_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ai profiles"
  ON public.channel_ai_profiles FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.channel_ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- --------------------------------------------------------
-- 2. KNOWLEDGE BASE ENTRIES
-- --------------------------------------------------------
CREATE TABLE public.knowledge_base_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source_type   TEXT DEFAULT 'text',
  file_name     TEXT,
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.knowledge_base_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own kb entries"
  ON public.knowledge_base_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own kb entries"
  ON public.knowledge_base_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own kb entries"
  ON public.knowledge_base_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own kb entries"
  ON public.knowledge_base_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_kb_entries_channel ON public.knowledge_base_entries(channel_id);

-- --------------------------------------------------------
-- 3. SUPABASE STORAGE BUCKET
-- --------------------------------------------------------
-- Create a private bucket for knowledge base file uploads.
-- Run this only if the bucket doesn't already exist:
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: users can upload/read/delete their own files
CREATE POLICY "Users can upload kb files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'knowledge-base'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read own kb files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'knowledge-base'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own kb files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'knowledge-base'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
