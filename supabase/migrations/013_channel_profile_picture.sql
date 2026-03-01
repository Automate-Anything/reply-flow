-- Add profile picture URL to whatsapp_channels
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
