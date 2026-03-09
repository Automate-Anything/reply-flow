-- ============================================================
-- Migration 038: User Ownership & Sharing Model
--
-- Shifts from company-scoped data to user-owned data with
-- explicit sharing controls at the channel, conversation,
-- and contact levels.
--
-- Two distinct concepts:
--   ACCESS  = who can see/interact (visibility)
--   ASSIGN  = who is responsible for handling (workflow)
--
-- Hierarchy: User → Channel → Conversations → Messages
-- Messages inherit visibility from their conversation.
-- ============================================================

-- ============================================================
-- STEP 1: Add sharing columns to whatsapp_channels
-- ============================================================

-- sharing_mode: controls who has access to this channel
--   'private'        = only the channel owner
--   'specific_users' = only users listed in channel_access
--   'all_members'    = all company members (backward compatible default)
ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS sharing_mode TEXT NOT NULL DEFAULT 'all_members';

-- default_conversation_visibility: when a channel is shared, do shared users
-- see all conversations or only conversations explicitly granted to them?
--   'all'        = shared users see all conversations (backward compatible default)
--   'owner_only' = conversations are private to the channel owner unless
--                  explicitly granted via conversation_access
ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS default_conversation_visibility TEXT NOT NULL DEFAULT 'all';

-- Add CHECK constraints
ALTER TABLE public.whatsapp_channels
  ADD CONSTRAINT chk_sharing_mode
    CHECK (sharing_mode IN ('private', 'specific_users', 'all_members'));

ALTER TABLE public.whatsapp_channels
  ADD CONSTRAINT chk_default_conversation_visibility
    CHECK (default_conversation_visibility IN ('all', 'owner_only'));

-- ============================================================
-- STEP 2: Create channel_access table
-- ============================================================
-- Records which users have been granted access to a channel
-- (only relevant when sharing_mode = 'specific_users')

CREATE TABLE public.channel_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    BIGINT NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  access_level  TEXT NOT NULL DEFAULT 'view',
  granted_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, user_id),
  CONSTRAINT chk_channel_access_level CHECK (access_level IN ('view', 'edit'))
);

ALTER TABLE public.channel_access ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_channel_access_channel ON public.channel_access(channel_id);
CREATE INDEX idx_channel_access_user ON public.channel_access(user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.channel_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- STEP 3: Create conversation_access table
-- ============================================================
-- Records which users have been granted access to specific conversations.
-- Only relevant when the channel's default_conversation_visibility = 'owner_only'.
-- A NULL user_id means "all users who have channel access".

CREATE TABLE public.conversation_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.users(id) ON DELETE CASCADE,
  access_level  TEXT NOT NULL DEFAULT 'view',
  granted_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, user_id),
  CONSTRAINT chk_conversation_access_level CHECK (access_level IN ('view', 'edit'))
);

ALTER TABLE public.conversation_access ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_conversation_access_session ON public.conversation_access(session_id);
CREATE INDEX idx_conversation_access_user ON public.conversation_access(user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- STEP 4: Add owner_id and sharing to contacts
-- ============================================================

-- owner_id: the user who owns/created this contact
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- sharing_mode for contacts (same semantics as channels)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS sharing_mode TEXT NOT NULL DEFAULT 'all_members';

ALTER TABLE public.contacts
  ADD CONSTRAINT chk_contact_sharing_mode
    CHECK (sharing_mode IN ('private', 'specific_users', 'all_members'));

-- Create contact_access table
CREATE TABLE public.contact_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  access_level  TEXT NOT NULL DEFAULT 'view',
  granted_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, user_id),
  CONSTRAINT chk_contact_access_level CHECK (access_level IN ('view', 'edit'))
);

ALTER TABLE public.contact_access ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_contact_access_contact ON public.contact_access(contact_id);
CREATE INDEX idx_contact_access_user ON public.contact_access(user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- STEP 5: Migrate existing data (preserve current behavior)
-- ============================================================

-- All existing channels default to 'all_members' + 'all' (already set via DEFAULT)
-- No channel_access rows needed since sharing_mode = 'all_members'

-- Set owner_id on contacts to their created_by (or user_id) value
UPDATE public.contacts
SET owner_id = COALESCE(created_by, user_id)
WHERE owner_id IS NULL;

-- All existing contacts default to 'all_members' (already set via DEFAULT)
-- No contact_access rows needed since sharing_mode = 'all_members'

-- ============================================================
-- STEP 6: RLS policies for new tables
-- ============================================================

-- Since the server uses supabaseAdmin (service role) which bypasses RLS,
-- access control is primarily enforced at the API route level.
-- These RLS policies are for direct Supabase client access (realtime, etc.).

-- channel_access: viewable by channel owner + users with access + company members who can view channels
CREATE POLICY "channel_access_select"
  ON public.channel_access FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_access.channel_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "channel_access_insert"
  ON public.channel_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_access.channel_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "channel_access_update"
  ON public.channel_access FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_access.channel_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "channel_access_delete"
  ON public.channel_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_channels wc
      WHERE wc.id = channel_access.channel_id
        AND wc.user_id = auth.uid()
    )
  );

-- conversation_access: viewable by the user who has access + channel owner
CREATE POLICY "conversation_access_select"
  ON public.conversation_access FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id
      WHERE cs.id = conversation_access.session_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_access_insert"
  ON public.conversation_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id
      WHERE cs.id = conversation_access.session_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_access_update"
  ON public.conversation_access FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id
      WHERE cs.id = conversation_access.session_id
        AND wc.user_id = auth.uid()
    )
  );

CREATE POLICY "conversation_access_delete"
  ON public.conversation_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.whatsapp_channels wc ON wc.id = cs.channel_id
      WHERE cs.id = conversation_access.session_id
        AND wc.user_id = auth.uid()
    )
  );

-- contact_access: viewable by the user who has access + contact owner
CREATE POLICY "contact_access_select"
  ON public.contact_access FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_access.contact_id
        AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "contact_access_insert"
  ON public.contact_access FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_access.contact_id
        AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "contact_access_update"
  ON public.contact_access FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_access.contact_id
        AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "contact_access_delete"
  ON public.contact_access FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_access.contact_id
        AND c.owner_id = auth.uid()
    )
  );
