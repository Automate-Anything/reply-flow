-- Add source URL columns for change detection
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_source_url TEXT;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS profile_picture_source_url TEXT;

-- Create public storage bucket for profile pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read profile pictures (they are public WhatsApp avatars)
CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'profile-pictures');

-- Allow service role to upload/overwrite profile pictures
CREATE POLICY "Service role upload"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'profile-pictures');

CREATE POLICY "Service role overwrite"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'profile-pictures');
