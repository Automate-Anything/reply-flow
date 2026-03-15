-- 060_drop_old_access_tables.sql
-- Drop old access tables and columns after verifying new system works.
-- This is a separate migration so it can be rolled back independently.

-- Drop old tables
DROP TABLE IF EXISTS public.conversation_access;
DROP TABLE IF EXISTS public.channel_access;
-- Note: contact_access is NOT dropped — contacts still use the old system

-- Remove old columns from whatsapp_channels
ALTER TABLE public.whatsapp_channels DROP COLUMN IF EXISTS sharing_mode;
ALTER TABLE public.whatsapp_channels DROP COLUMN IF EXISTS default_conversation_visibility;
