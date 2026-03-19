-- 070_channel_abstraction.sql
-- Rename whatsapp_channels to channels and add channel_type column

-- 1. Rename the table
ALTER TABLE public.whatsapp_channels RENAME TO channels;

-- 2. Add channel_type column with default 'whatsapp' for all existing rows
ALTER TABLE public.channels
  ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'whatsapp';

-- 3. Add display_name column (generic name for any channel - email address, phone, etc.)
ALTER TABLE public.channels
  ADD COLUMN display_identifier TEXT;

-- 4. Backfill display_identifier from phone_number for existing WhatsApp channels
UPDATE public.channels SET display_identifier = phone_number WHERE channel_type = 'whatsapp';

-- 5. Add columns for email channel OAuth tokens (nullable for WhatsApp)
ALTER TABLE public.channels
  ADD COLUMN oauth_access_token TEXT,
  ADD COLUMN oauth_refresh_token TEXT,
  ADD COLUMN oauth_token_expiry TIMESTAMPTZ,
  ADD COLUMN oauth_scopes TEXT[],
  ADD COLUMN gmail_history_id TEXT,
  ADD COLUMN gmail_watch_expiry TIMESTAMPTZ,
  ADD COLUMN email_address TEXT,
  ADD COLUMN email_signature TEXT;

-- 6. Add check constraint for channel_type
ALTER TABLE public.channels
  ADD CONSTRAINT channels_type_check CHECK (channel_type IN ('whatsapp', 'email'));

-- 7. Add index on channel_type for filtering
CREATE INDEX idx_channels_type ON public.channels (channel_type);

-- 8. Add unique constraint for email channels (one email per company)
CREATE UNIQUE INDEX idx_channels_email_company
  ON public.channels (company_id, email_address)
  WHERE channel_type = 'email' AND email_address IS NOT NULL;

-- 9. Drop and recreate RLS policies with new table name
-- (Postgres auto-renames policies when table is renamed, but let's be explicit)
-- The policies already reference the correct table via OID, so they auto-follow the rename.
-- No action needed for RLS policies.

-- 10. Create a backwards-compat view for any raw SQL that might reference old name
-- NOTE: This view is READ-ONLY. No code should INSERT/UPDATE/DELETE via this view.
-- All writes must go through the 'channels' table directly.
CREATE VIEW public.whatsapp_channels AS
  SELECT * FROM public.channels WHERE channel_type = 'whatsapp';
