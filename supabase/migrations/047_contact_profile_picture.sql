-- Add profile picture URL to contacts, fetched from WhatsApp via Whapi API
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
