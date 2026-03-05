-- ============================================================
-- MIGRATION 020: SUPER ADMIN & PROMPT TEMPLATES
-- Adds is_super_admin flag to users table.
-- Creates prompt_templates table for editable prompt skeletons.
-- ============================================================

-- ============================================================
-- STEP 1: ADD is_super_admin TO USERS TABLE
-- Manually set via Supabase dashboard — no UI for granting.
-- ============================================================
ALTER TABLE public.users
  ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- STEP 2: CREATE prompt_templates TABLE
-- Stores the editable prompt skeleton strings used by the
-- prompt builder (tone, length, emoji descriptions, core rules).
-- System-wide (not per-company).
-- ============================================================
CREATE TABLE public.prompt_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  category    TEXT NOT NULL,
  label       TEXT NOT NULL,
  content     TEXT NOT NULL,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.prompt_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- STEP 3: SEED DEFAULT PROMPT TEMPLATES
-- Values taken from the hardcoded constants in promptBuilder.ts.
-- ============================================================
INSERT INTO public.prompt_templates (key, category, label, content) VALUES
  -- Tone descriptions
  ('tone.professional', 'tone', 'Professional', 'Maintain a professional, polished tone. Be respectful and business-appropriate.'),
  ('tone.friendly', 'tone', 'Friendly', 'Be warm, approachable, and personable. Use a conversational but helpful tone.'),
  ('tone.casual', 'tone', 'Casual', 'Keep things relaxed and informal. Use everyday language and be easygoing.'),
  ('tone.formal', 'tone', 'Formal', 'Use formal language and proper etiquette. Be courteous and dignified.'),
  -- Response length descriptions
  ('length.concise', 'length', 'Concise', 'Keep responses short and to the point. Aim for 1-3 sentences when possible.'),
  ('length.moderate', 'length', 'Moderate', 'Provide clear, balanced responses. Use enough detail to be helpful without being verbose.'),
  ('length.detailed', 'length', 'Detailed', 'Give thorough, comprehensive responses. Include relevant details and explanations.'),
  -- Emoji usage descriptions
  ('emoji.none', 'emoji', 'None', 'Do not use emojis in your responses.'),
  ('emoji.minimal', 'emoji', 'Minimal', 'Use emojis sparingly, only when they add warmth or clarity.'),
  ('emoji.moderate', 'emoji', 'Moderate', 'Feel free to use emojis to add personality and friendliness.'),
  -- Core rules
  ('core_rules', 'core_rules', 'Core Rules', 'You are chatting via WhatsApp. Keep messages appropriate for mobile messaging.
Never reveal that you are an AI unless directly asked.
If you don''t know the answer to something, be honest about it rather than making up information.
Never share sensitive business information like internal processes, pricing strategies, or employee details unless explicitly covered in the knowledge base.
If a conversation requires human attention (complaints, complex issues, urgent matters), politely let the customer know that a team member will follow up.')
ON CONFLICT (key) DO NOTHING;
