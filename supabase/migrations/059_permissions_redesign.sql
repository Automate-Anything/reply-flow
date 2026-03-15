-- 059_permissions_redesign.sql
-- Access & Permissions Redesign: new enum, tables, indexes, RLS, triggers, data migration

-- 1. Create enum
CREATE TYPE public.access_level AS ENUM ('no_access', 'view', 'reply', 'manage');

-- 2. Create channel_permissions table
CREATE TABLE public.channel_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  access_level public.access_level NOT NULL,
  granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraints: partial index for NULL user_id, regular constraint for non-NULL
-- The regular UNIQUE constraint is needed for Supabase .upsert() onConflict to work
ALTER TABLE public.channel_permissions
  ADD CONSTRAINT channel_permissions_channel_user_unique UNIQUE (channel_id, user_id);
CREATE UNIQUE INDEX idx_channel_perm_unique_all
  ON public.channel_permissions(channel_id) WHERE user_id IS NULL;

-- Query indexes
CREATE INDEX idx_channel_perm_channel ON public.channel_permissions(channel_id);
CREATE INDEX idx_channel_perm_user ON public.channel_permissions(user_id);
CREATE INDEX idx_channel_perm_company ON public.channel_permissions(company_id);

-- 3. Create conversation_permissions table
CREATE TABLE public.conversation_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  access_level public.access_level NOT NULL,
  granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraints: regular for non-NULL (needed for .upsert() onConflict), partial for NULL
ALTER TABLE public.conversation_permissions
  ADD CONSTRAINT conversation_permissions_session_user_unique UNIQUE (session_id, user_id);
CREATE UNIQUE INDEX idx_conv_perm_unique_all
  ON public.conversation_permissions(session_id) WHERE user_id IS NULL;

-- Query indexes
CREATE INDEX idx_conversation_perm_session ON public.conversation_permissions(session_id);
CREATE INDEX idx_conversation_perm_user ON public.conversation_permissions(user_id);
CREATE INDEX idx_conv_perm_company ON public.conversation_permissions(company_id);
CREATE INDEX idx_conv_perm_user_level ON public.conversation_permissions(user_id, access_level);

-- 4. Updated_at triggers
CREATE TRIGGER set_channel_perm_updated_at
  BEFORE UPDATE ON public.channel_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_conv_perm_updated_at
  BEFORE UPDATE ON public.conversation_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 5. RLS policies (company-scoped safety net; full auth at API layer)
ALTER TABLE public.channel_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_permissions_select" ON public.channel_permissions
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "channel_permissions_insert" ON public.channel_permissions
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "channel_permissions_update" ON public.channel_permissions
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "channel_permissions_delete" ON public.channel_permissions
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_permissions_select" ON public.conversation_permissions
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_permissions_insert" ON public.conversation_permissions
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_permissions_update" ON public.conversation_permissions
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_permissions_delete" ON public.conversation_permissions
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

-- 6. Data migration: channel_access → channel_permissions
-- all_members channels: insert NULL user_id row with 'reply'
INSERT INTO public.channel_permissions (channel_id, user_id, access_level, granted_by, company_id)
SELECT wc.id, NULL, 'reply'::public.access_level, wc.user_id, wc.company_id
FROM public.whatsapp_channels wc
WHERE wc.sharing_mode = 'all_members';

-- specific_users channels: migrate individual grants (edit→reply, view→view)
INSERT INTO public.channel_permissions (channel_id, user_id, access_level, granted_by, company_id)
SELECT ca.channel_id, ca.user_id,
  CASE ca.access_level WHEN 'edit' THEN 'reply'::public.access_level ELSE 'view'::public.access_level END,
  ca.granted_by, wc.company_id
FROM public.channel_access ca
JOIN public.whatsapp_channels wc ON wc.id = ca.channel_id;

-- 7. Data migration: conversation_access → conversation_permissions
-- Migrate all existing conversation_access rows (edit→reply, view→view)
INSERT INTO public.conversation_permissions (session_id, user_id, access_level, granted_by, company_id)
SELECT ca.session_id, ca.user_id,
  CASE ca.access_level WHEN 'edit' THEN 'reply'::public.access_level ELSE 'view'::public.access_level END,
  ca.granted_by, wc.company_id
FROM public.conversation_access ca
JOIN public.chat_sessions cs ON cs.id = ca.session_id
JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id;

-- For owner_only channels: block all non-granted conversations
-- Insert no_access for all-users on conversations in owner_only channels
-- that don't already have a NULL user_id conversation_permissions row
INSERT INTO public.conversation_permissions (session_id, user_id, access_level, granted_by, company_id)
SELECT cs.id, NULL, 'no_access'::public.access_level, wc.user_id, wc.company_id
FROM public.chat_sessions cs
JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id
WHERE wc.default_conversation_visibility = 'owner_only'
  AND wc.sharing_mode != 'private'
  AND NOT EXISTS (
    SELECT 1 FROM public.conversation_permissions cp
    WHERE cp.session_id = cs.id AND cp.user_id IS NULL
  );
