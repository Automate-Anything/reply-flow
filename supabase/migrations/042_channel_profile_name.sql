-- Add profile_name column to store the WhatsApp account's display name
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS profile_name TEXT;
