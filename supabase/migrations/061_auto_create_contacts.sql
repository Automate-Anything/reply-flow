-- Add auto_create_contacts setting to companies table
-- When true (default), contacts are automatically created when an unknown number messages.
-- When false, messages from unknown numbers are still processed but no contact record is created.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_create_contacts boolean NOT NULL DEFAULT true;
