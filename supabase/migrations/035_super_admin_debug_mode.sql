-- ============================================================
-- MIGRATION 035: SUPER ADMIN DEBUG MODE
-- Adds a debug_mode toggle to the retrieval_settings table.
-- When enabled, AI pipeline captures and stores debug metadata
-- in chat_messages.metadata for super admin visibility, and
-- KB uploads stream pipeline progress via SSE.
-- ============================================================

INSERT INTO public.retrieval_settings (key, value, label, description) VALUES
  ('super_admin_debug_mode', '0', 'Super Admin Debug Mode',
   'When enabled, AI responses store debug metadata and KB uploads stream pipeline progress.')
ON CONFLICT (key) DO NOTHING;
