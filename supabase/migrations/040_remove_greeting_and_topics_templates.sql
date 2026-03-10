-- ============================================================
-- MIGRATION 040: REMOVE GREETING & TOPICS TO AVOID TEMPLATES
-- These fields have been removed from the response flow.
-- ============================================================

DELETE FROM public.prompt_templates
WHERE category IN ('greeting', 'topics_to_avoid');
