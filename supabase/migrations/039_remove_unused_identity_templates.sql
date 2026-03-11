-- ============================================================
-- MIGRATION 039: SIMPLIFY IDENTITY TEMPLATES
-- The app now always uses the 'business' identity. Remove the
-- unused variants and improve the business template.
-- ============================================================

DELETE FROM public.prompt_templates
WHERE key IN ('identity.organization', 'identity.personal', 'identity.default');

UPDATE public.prompt_templates
SET content = 'You are the AI-powered WhatsApp assistant for {name}. You represent this business in customer conversations — answering questions, providing information, and ensuring every customer feels heard and helped.'
WHERE key = 'identity.business';
