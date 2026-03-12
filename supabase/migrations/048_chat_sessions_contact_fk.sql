-- Add foreign key from chat_sessions.contact_id to contacts.id
-- This enables Supabase PostgREST to resolve the JOIN for profile_picture_url
ALTER TABLE chat_sessions
  ADD CONSTRAINT chat_sessions_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
