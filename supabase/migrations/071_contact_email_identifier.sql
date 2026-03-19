-- Allow contacts without phone numbers (email-only contacts)
ALTER TABLE public.contacts ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN phone_number SET DEFAULT '';

-- Add display_name column
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill display_name from whatsapp_name
UPDATE public.contacts SET display_name = whatsapp_name WHERE whatsapp_name IS NOT NULL AND display_name IS NULL;

-- Unique constraint for email-only contacts
CREATE UNIQUE INDEX idx_contacts_company_email_unique
  ON public.contacts (company_id, email)
  WHERE email IS NOT NULL AND email != '' AND is_deleted = false AND (phone_number IS NULL OR phone_number = '');
