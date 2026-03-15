# Access & Permissions Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the channel/conversation permission system with 4 granular levels (no_access/view/reply/manage), bidirectional conversation overrides, live inheritance, and smart conflict resolution UI.

**Architecture:** Clean rebuild — new `channel_permissions` and `conversation_permissions` tables with a Postgres enum, new `accessControl.ts` service with override-replaces semantics, new conflict detection service, and updated UI components. Old tables coexist during migration then get dropped in a separate migration.

**Tech Stack:** Supabase (Postgres), Express 5, React 19, Radix/shadcn UI, Tailwind CSS, Axios, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-access-permissions-redesign.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/059_permissions_redesign.sql` | New enum, tables, indexes, RLS, triggers, data migration |
| `supabase/migrations/060_drop_old_access_tables.sql` | Drop old tables/columns (separate, after verification) |
| `server/src/services/permissionResolver.ts` | Pure permission resolution logic (getChannelAccess, getConversationAccess, getAccessibleSessions) |
| `server/src/services/conflictDetection.ts` | Conflict detection when channel permissions change |
| `client/src/components/access/ConflictResolutionModal.tsx` | Smart popup for resolving conflicts on channel changes |
| `client/src/components/access/PermissionLevelSelect.tsx` | Reusable dropdown for no_access/view/reply/manage |
| `client/src/components/inbox/OverrideShieldIcon.tsx` | Shield ↑↓ indicator component with tooltip |
| `client/src/hooks/usePermissions.ts` | New hooks replacing useAccessControl (useChannelPermissions, useConversationPermissions) |

### Modified Files

| File | Changes |
|------|---------|
| `server/src/routes/access.ts` | Rewrite all endpoints for new tables + add conflict resolution endpoint |
| `server/src/routes/conversations.ts` | Update filtering to use new permissionResolver |
| `server/src/services/accessControl.ts` | Remove channel/conversation functions, keep getContactAccess only |
| `client/src/components/access/AccessManager.tsx` | Rewrite for 4-level model, override badges, inheritance display |
| `client/src/components/settings/ChannelDetailView.tsx` | Update channel access section for new UI |
| `client/src/components/inbox/ConversationHeader.tsx` | Update to use new hooks + new AccessManager props |
| `client/src/components/inbox/ConversationItem.tsx` | Add shield indicator |
| `client/src/components/inbox/ConversationContextMenu.tsx` | Add "Manage access" menu item |
| `client/src/hooks/useConversations.ts` | Add override metadata to Conversation type |
| `client/src/hooks/useAccessControl.ts` | Remove channel/conversation hooks, keep useContactAccess only |

---

## Chunk 1: Database Migration + Permission Resolver

### Task 1: Create the database migration

**Files:**
- Create: `supabase/migrations/059_permissions_redesign.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Verify migration SQL is syntactically valid**

Run: `npx tsc --noEmit --project server/tsconfig.json` (to ensure no TS breakage — migration is SQL-only, this just confirms server still compiles)
Expected: No errors (migration doesn't touch TS yet)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/059_permissions_redesign.sql
git commit -m "feat: add permissions redesign migration (059)"
```

---

### Task 2: Write the permission resolver service

**Files:**
- Create: `server/src/services/permissionResolver.ts`

- [ ] **Step 1: Create the permission resolver with channel access resolution**

```typescript
// server/src/services/permissionResolver.ts
import { supabaseAdmin } from '../config/supabase.js';

export type AccessLevel = 'no_access' | 'view' | 'reply' | 'manage';

const LEVEL_ORDER: Record<AccessLevel, number> = {
  no_access: 0,
  view: 1,
  reply: 2,
  manage: 3,
};

export function isAtLeast(level: AccessLevel, minimum: AccessLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum];
}

/**
 * Resolve a user's access level on a channel.
 * Owner always gets 'manage'. Specific user entry beats all-members entry.
 */
export async function getChannelAccess(
  userId: string,
  channelId: number,
  companyId: string
): Promise<AccessLevel | null> {
  // Check if user is channel owner
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id')
    .eq('id', channelId)
    .eq('company_id', companyId)
    .single();

  if (!channel) return null;
  if (channel.user_id === userId) return 'manage';

  // Look for user-specific entry first, then fall back to all-members (NULL)
  const { data: perms } = await supabaseAdmin
    .from('channel_permissions')
    .select('user_id, access_level')
    .eq('channel_id', channelId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('user_id', { ascending: false, nullsFirst: false });

  if (!perms || perms.length === 0) return null;

  // First non-null match is user-specific; otherwise use the NULL (all-members) row
  const specific = perms.find((p) => p.user_id === userId);
  const allMembers = perms.find((p) => p.user_id === null);

  if (specific) return specific.access_level as AccessLevel;
  if (allMembers) return allMembers.access_level as AccessLevel;
  return null;
}

/**
 * Resolve a user's access level on a conversation.
 * Owner always gets 'manage'. Override replaces channel level (not most-restrictive).
 * Channel is the gateway — null/no_access at channel blocks everything.
 *
 * Signature matches old API (userId, sessionId, companyId) so callers don't need changes.
 * channelId is optional — if not provided, it's looked up from the session.
 */
export async function getConversationAccess(
  userId: string,
  sessionId: string,
  companyId: string,
  channelId?: number
): Promise<AccessLevel | null> {
  // Look up channelId if not provided
  if (!channelId) {
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', sessionId)
      .single();
    if (!session?.channel_id) return null;
    channelId = session.channel_id;
  }

  // Owner check — always manage on every conversation
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id')
    .eq('id', channelId)
    .eq('company_id', companyId)
    .single();

  if (!channel) return null;
  if (channel.user_id === userId) return 'manage';

  // Channel gateway
  const channelAccess = await getChannelAccess(userId, channelId, companyId);
  if (!channelAccess) return null;
  if (channelAccess === 'no_access') return 'no_access';

  // Look for conversation-level override (specific user beats NULL)
  const { data: convPerms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('user_id, access_level')
    .eq('session_id', sessionId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('user_id', { ascending: false, nullsFirst: false });

  if (!convPerms || convPerms.length === 0) return channelAccess; // Inherit

  const specific = convPerms.find((p) => p.user_id === userId);
  const allUsers = convPerms.find((p) => p.user_id === null);

  if (specific) return specific.access_level as AccessLevel;
  if (allUsers) return allUsers.access_level as AccessLevel;
  return channelAccess; // Inherit
}

/**
 * Get all channel IDs a user can access (not null, not no_access).
 */
export async function getAccessibleChannelIds(
  userId: string,
  companyId: string
): Promise<number[]> {
  // Run all four queries concurrently for performance (hot path)
  const [
    { data: owned },
    { data: allMember },
    { data: specific },
    { data: blocked },
  ] = await Promise.all([
    // Channels user owns
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId),
    // Channels with all-members access (NULL user_id, not no_access)
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .is('user_id', null)
      .neq('access_level', 'no_access'),
    // Channels with specific user access (not no_access)
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .neq('access_level', 'no_access'),
    // Channels where user has explicit no_access
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('access_level', 'no_access'),
  ]);

  const ids = new Set<number>();
  owned?.forEach((c) => ids.add(c.id));
  allMember?.forEach((c) => ids.add(c.channel_id));
  specific?.forEach((c) => ids.add(c.channel_id));

  // But don't remove owned channels (owner always has access)
  const ownedIds = new Set(owned?.map((c) => c.id) || []);
  blocked?.forEach((b) => {
    if (!ownedIds.has(b.channel_id)) {
      ids.delete(b.channel_id);
    }
  });

  return Array.from(ids);
}

export type SessionFilter = {
  mode: 'all';
} | {
  mode: 'filtered';
  channelIds: number[];
  excludedSessionIds: string[];
};

export interface OverrideMeta {
  sessionId: string;
  escalationCount: number;
  restrictionCount: number;
  escalationNames: string[];
  restrictionNames: string[];
}

/**
 * Get the filter for accessible sessions + override metadata for shield indicators.
 */
export async function getAccessibleSessions(
  userId: string,
  companyId: string
): Promise<{ filter: SessionFilter; }> {
  const channelIds = await getAccessibleChannelIds(userId, companyId);

  if (channelIds.length === 0) {
    return { filter: { mode: 'filtered', channelIds: [], excludedSessionIds: [] } };
  }

  // Find conversations with no_access overrides for this user or all-users
  const { data: noAccessPerms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level')
    .in('company_id', [companyId])
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('access_level', 'no_access');

  const excludedSessionIds: string[] = [];

  if (noAccessPerms && noAccessPerms.length > 0) {
    // Group by session_id to resolve specific-vs-null priority
    const bySession = new Map<string, typeof noAccessPerms>();
    for (const p of noAccessPerms) {
      const list = bySession.get(p.session_id) || [];
      list.push(p);
      bySession.set(p.session_id, list);
    }

    for (const [sessionId, perms] of bySession) {
      const userSpecific = perms.find((p) => p.user_id === userId);
      const allUsers = perms.find((p) => p.user_id === null);

      if (userSpecific) {
        // User has explicit no_access — check if there's also a non-no_access specific override
        // (shouldn't happen with unique constraint, but defensive)
        excludedSessionIds.push(sessionId);
      } else if (allUsers) {
        // All-users no_access — check if user has a specific override that reinstates
        const { data: reinstated } = await supabaseAdmin
          .from('conversation_permissions')
          .select('access_level')
          .eq('session_id', sessionId)
          .eq('user_id', userId)
          .neq('access_level', 'no_access')
          .limit(1);

        if (!reinstated || reinstated.length === 0) {
          excludedSessionIds.push(sessionId);
        }
      }
    }
  }

  return {
    filter: { mode: 'filtered', channelIds, excludedSessionIds },
  };
}

/**
 * Get override metadata for a batch of session IDs (for shield indicators).
 * Call this with the session IDs from the current page/batch.
 *
 * NOTE: Escalation/restriction is determined by comparing the conversation override
 * against the channel's all-members default level. This is a simplification — ideally
 * we'd compare against each user's specific channel access, but that requires N lookups.
 * For the shield indicator (which is a summary), the all-members default is a reasonable
 * approximation. The full per-user comparison happens in the conversation access panel.
 */
export async function getOverrideMetadata(
  sessionIds: string[],
  companyId: string
): Promise<OverrideMeta[]> {
  if (sessionIds.length === 0) return [];

  // Get all conversation_permissions for these sessions
  const { data: perms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level, user:user_id(full_name)')
    .eq('company_id', companyId)
    .in('session_id', sessionIds);

  if (!perms || perms.length === 0) return [];

  // For each session, we need to know the channel-level access to determine
  // if an override is an escalation or restriction.
  // Get channel info for these sessions
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, channel_id')
    .in('id', sessionIds);

  const sessionChannelMap = new Map<string, number>();
  sessions?.forEach((s) => {
    if (s.channel_id) sessionChannelMap.set(s.id, s.channel_id);
  });

  // Get channel-level defaults (the NULL user_id rows)
  const channelIds = [...new Set(sessionChannelMap.values())];
  const { data: channelDefaults } = await supabaseAdmin
    .from('channel_permissions')
    .select('channel_id, access_level')
    .in('channel_id', channelIds)
    .is('user_id', null);

  const channelDefaultLevel = new Map<number, AccessLevel>();
  channelDefaults?.forEach((cd) => {
    channelDefaultLevel.set(cd.channel_id, cd.access_level as AccessLevel);
  });

  // Group overrides by session
  const bySession = new Map<string, typeof perms>();
  for (const p of perms) {
    const list = bySession.get(p.session_id) || [];
    list.push(p);
    bySession.set(p.session_id, list);
  }

  const result: OverrideMeta[] = [];

  for (const [sessionId, overrides] of bySession) {
    const channelId = sessionChannelMap.get(sessionId);
    const defaultLevel = channelId ? channelDefaultLevel.get(channelId) : undefined;
    const defaultOrder = defaultLevel ? LEVEL_ORDER[defaultLevel] : LEVEL_ORDER.reply;

    let escalationCount = 0;
    let restrictionCount = 0;
    const escalationNames: string[] = [];
    const restrictionNames: string[] = [];

    for (const o of overrides) {
      const overrideOrder = LEVEL_ORDER[o.access_level as AccessLevel];
      const name = (o.user as any)?.full_name || 'All users';

      if (overrideOrder > defaultOrder) {
        escalationCount++;
        escalationNames.push(name);
      } else if (overrideOrder < defaultOrder) {
        restrictionCount++;
        restrictionNames.push(name);
      }
      // Equal = redundant override, don't count
    }

    if (escalationCount > 0 || restrictionCount > 0) {
      result.push({ sessionId, escalationCount, restrictionCount, escalationNames, restrictionNames });
    }
  }

  return result;
}

/**
 * Auto-grant conversation access when a user is assigned.
 * Only creates/upgrades override if user doesn't already have reply+ access.
 */
export async function ensureConversationAccessOnAssign(
  sessionId: string,
  assignedUserId: string,
  grantedByUserId: string,
  companyId: string
): Promise<void> {
  // Get the session's channel
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id')
    .eq('id', sessionId)
    .single();

  if (!session?.channel_id) return;

  // Check if user has channel access
  const channelAccess = await getChannelAccess(assignedUserId, session.channel_id, companyId);
  if (!channelAccess || channelAccess === 'no_access') return; // Can't assign without channel access

  // Check current conversation access
  const convAccess = await getConversationAccess(
    assignedUserId, session.channel_id, sessionId, companyId
  );

  // If already reply or manage, no action needed
  if (convAccess && isAtLeast(convAccess, 'reply')) return;

  // Upsert a reply override
  await supabaseAdmin
    .from('conversation_permissions')
    .upsert(
      {
        session_id: sessionId,
        user_id: assignedUserId,
        access_level: 'reply',
        granted_by: grantedByUserId,
        company_id: companyId,
      },
      { onConflict: 'session_id,user_id' }
    );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add server/src/services/permissionResolver.ts
git commit -m "feat: add permission resolver service with new 4-level model"
```

---

### Task 3: Write the conflict detection service

**Files:**
- Create: `server/src/services/conflictDetection.ts`

- [ ] **Step 1: Create the conflict detection service**

```typescript
// server/src/services/conflictDetection.ts
import { supabaseAdmin } from '../config/supabase.js';
import { getChannelAccess, AccessLevel } from './permissionResolver.js';

export interface PermissionConflict {
  userId: string;
  userName: string;
  sessionIds: string[];
  currentChannelLevel: AccessLevel;
  conversationOverrides: Array<{
    sessionId: string;
    accessLevel: AccessLevel;
  }>;
}

export interface ConflictResolution {
  userId: string;
  action: 'keep' | 'remove';
}

/**
 * Detect which users will lose channel access and have active conversation overrides.
 * Called BEFORE applying channel permission changes.
 *
 * @param channelId - The channel being modified
 * @param companyId - Company scope
 * @param usersLosingAccess - User IDs that will have null/no_access after the change
 */
export async function detectConflicts(
  channelId: number,
  companyId: string,
  usersLosingAccess: string[]
): Promise<PermissionConflict[]> {
  if (usersLosingAccess.length === 0) return [];

  // Get all sessions in this channel
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);

  // Find conversation overrides for the affected users (not no_access — those are already blocks)
  const { data: overrides } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level, user:user_id(full_name)')
    .in('session_id', sessionIds)
    .in('user_id', usersLosingAccess)
    .neq('access_level', 'no_access');

  if (!overrides || overrides.length === 0) return [];

  // Group by user
  const byUser = new Map<string, PermissionConflict>();

  for (const o of overrides) {
    if (!o.user_id) continue;

    let conflict = byUser.get(o.user_id);
    if (!conflict) {
      conflict = {
        userId: o.user_id,
        userName: (o.user as any)?.full_name || 'Unknown',
        sessionIds: [],
        currentChannelLevel: 'reply', // Will be resolved below
        conversationOverrides: [],
      };
      byUser.set(o.user_id, conflict);
    }

    conflict.sessionIds.push(o.session_id);
    conflict.conversationOverrides.push({
      sessionId: o.session_id,
      accessLevel: o.access_level as AccessLevel,
    });
  }

  // Resolve current channel access for each affected user
  for (const conflict of byUser.values()) {
    const access = await getChannelAccess(conflict.userId, channelId, companyId);
    conflict.currentChannelLevel = access || 'no_access';
  }

  return Array.from(byUser.values());
}

/**
 * Compute which users will lose channel access given a proposed change.
 * Compares current permissions with proposed new state.
 */
export async function computeUsersLosingAccess(
  channelId: number,
  companyId: string,
  proposedChange: {
    removeAllMembersRow?: boolean;
    removeUserIds?: string[];
    addNoAccessUserIds?: string[];
  }
): Promise<string[]> {
  const losingAccess: string[] = [];

  // Users being explicitly removed
  if (proposedChange.removeUserIds) {
    losingAccess.push(...proposedChange.removeUserIds);
  }

  // Users getting explicit no_access
  if (proposedChange.addNoAccessUserIds) {
    losingAccess.push(...proposedChange.addNoAccessUserIds);
  }

  // If removing all-members row, find all company members who don't have
  // individual channel_permissions entries
  if (proposedChange.removeAllMembersRow) {
    const { data: companyMembers } = await supabaseAdmin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId);

    const { data: individualPerms } = await supabaseAdmin
      .from('channel_permissions')
      .select('user_id')
      .eq('channel_id', channelId)
      .not('user_id', 'is', null);

    // Channel owner
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .single();

    const hasIndividualPerm = new Set(individualPerms?.map((p) => p.user_id) || []);
    const ownerId = channel?.user_id;

    for (const member of companyMembers || []) {
      if (member.user_id !== ownerId && !hasIndividualPerm.has(member.user_id)) {
        losingAccess.push(member.user_id);
      }
    }
  }

  return [...new Set(losingAccess)]; // Deduplicate
}

/**
 * Apply conflict resolutions atomically.
 * For 'keep' users: add them to channel with 'view' (minimum access).
 * For 'remove' users: delete their conversation overrides.
 */
export async function applyConflictResolutions(
  channelId: number,
  companyId: string,
  grantedBy: string,
  resolutions: ConflictResolution[]
): Promise<void> {
  const keepUsers = resolutions.filter((r) => r.action === 'keep');
  const removeUsers = resolutions.filter((r) => r.action === 'remove');

  // Get session IDs for this channel
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  const sessionIds = sessions?.map((s) => s.id) || [];

  // For 'keep' users: upsert channel_permissions with 'view'
  for (const user of keepUsers) {
    await supabaseAdmin
      .from('channel_permissions')
      .upsert(
        {
          channel_id: channelId,
          user_id: user.userId,
          access_level: 'view',
          granted_by: grantedBy,
          company_id: companyId,
        },
        { onConflict: 'channel_id,user_id' }
      );
  }

  // For 'remove' users: delete their conversation overrides in this channel
  if (removeUsers.length > 0 && sessionIds.length > 0) {
    const removeUserIds = removeUsers.map((r) => r.userId);
    await supabaseAdmin
      .from('conversation_permissions')
      .delete()
      .in('session_id', sessionIds)
      .in('user_id', removeUserIds);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/services/conflictDetection.ts
git commit -m "feat: add conflict detection service for channel permission changes"
```

---

### Task 4: Rewrite the access routes

**Files:**
- Modify: `server/src/routes/access.ts`

- [ ] **Step 1: Rewrite the access routes for the new permission model**

Replace the entire contents of `server/src/routes/access.ts` with the new implementation. Key changes:
- All endpoints use `channel_permissions` / `conversation_permissions` tables
- 4 access levels instead of 2
- `manage` check replaces owner-only check (owner OR anyone with manage)
- New conflict detection endpoint: `POST /access/channels/:channelId/check-conflicts`
- New conflict resolution endpoint: `POST /access/channels/:channelId/resolve-conflicts`
- Channel mode is derived from data (no `sharing_mode` column)
- Contact access routes left unchanged (out of scope)

The route file is 531 lines — the full rewrite will be written during implementation with the exact same Express patterns (Router, requireAuth, try/catch, supabaseAdmin queries, JSON responses).

Key new endpoints:
```
GET    /channels/:channelId              — fetch channel permissions + derived mode
PATCH  /channels/:channelId              — update channel permissions (bulk replace)
PUT    /channels/:channelId/users/:uid   — grant/update individual user permission
DELETE /channels/:channelId/users/:uid   — revoke individual user permission
POST   /channels/:channelId/check-conflicts  — preview conflicts before applying changes
POST   /channels/:channelId/resolve-conflicts — apply channel changes + conflict resolutions

GET    /conversations/:sessionId              — fetch conversation permissions
PUT    /conversations/:sessionId/users/:uid   — grant/update conversation override
DELETE /conversations/:sessionId/users/:uid   — remove conversation override

(Contact routes unchanged)
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/access.ts
git commit -m "feat: rewrite access routes for new 4-level permission model"
```

---

### Task 5: Update conversation list filtering

**Files:**
- Modify: `server/src/routes/conversations.ts` (lines 33-62)

- [ ] **Step 1: Replace old access filter with new permissionResolver**

Update the import from `accessControl.ts` to `permissionResolver.ts` and change the filter application:

```typescript
// Old:
import { getAccessibleSessionFilter } from '../services/accessControl.js';
// New:
import { getAccessibleSessions, getOverrideMetadata } from '../services/permissionResolver.js';
```

Replace the filter logic (lines 33-62) with:

```typescript
import { getAccessibleSessions, getOverrideMetadata } from '../services/permissionResolver.js';

// Inside the GET handler:
const { filter } = await getAccessibleSessions(req.userId!, companyId);

if (filter.mode === 'filtered') {
  if (filter.channelIds.length === 0) {
    return res.json({ sessions: [], count: 0 });
  }
  query = query.in('channel_id', filter.channelIds);
  if (filter.excludedSessionIds.length > 0) {
    query = query.not('id', 'in', `(${filter.excludedSessionIds.join(',')})`);
  }
}
// If filter.mode === 'all', no filtering needed (same as before)
```

After the main query returns sessions, fetch override metadata for the returned batch:

```typescript
const sessionIds = sessions.map((s: any) => s.id);
const overrideMeta = await getOverrideMetadata(sessionIds, companyId);

// Merge into response
const metaMap = new Map(overrideMeta.map((m) => [m.sessionId, m]));
const enrichedSessions = sessions.map((s: any) => ({
  ...s,
  override_meta: metaMap.get(s.id) || null,
}));
```

- [ ] **Step 2: Update the assignment auto-grant**

Update the conversation PATCH endpoint (around line 406) to use the new `ensureConversationAccessOnAssign` from `permissionResolver.ts`.

- [ ] **Step 3: Verify TypeScript compiles and test manually**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/conversations.ts
git commit -m "feat: update conversation filtering to use new permission resolver"
```

---

## Chunk 2: Client-Side Hooks + Shared Components

### Task 6: Create the new permissions hooks

**Files:**
- Create: `client/src/hooks/usePermissions.ts`

- [ ] **Step 1: Create useChannelPermissions and useConversationPermissions hooks**

```typescript
// client/src/hooks/usePermissions.ts
import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

export type AccessLevel = 'no_access' | 'view' | 'reply' | 'manage';

export interface PermissionEntry {
  id: string;
  user_id: string | null;
  access_level: AccessLevel;
  created_at: string;
  user: {
    id: string;
    full_name: string;
    email: string;
    avatar_url: string | null;
  } | null;
}

export interface ChannelPermissionSettings {
  mode: 'private' | 'specific_users' | 'all_members';
  defaultLevel: AccessLevel | null; // The level for all-members row (null if private/specific)
  owner: { id: string; full_name: string; email: string; avatar_url: string | null };
  permissions: PermissionEntry[];
}

export interface ConversationPermissionSettings {
  channelDefaultLevel: AccessLevel | null;
  permissions: PermissionEntry[]; // Conversation-level overrides
  inherited: PermissionEntry[];   // What's inherited from channel (read-only)
}

export interface PermissionConflict {
  userId: string;
  userName: string;
  sessionIds: string[];
  currentChannelLevel: AccessLevel;
  conversationOverrides: Array<{ sessionId: string; accessLevel: AccessLevel }>;
}

export interface ConflictResolution {
  userId: string;
  action: 'keep' | 'remove';
}

export function useChannelPermissions(channelId: number | null) {
  const [settings, setSettings] = useState<ChannelPermissionSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/channels/${channelId}`);
      setSettings(data);
    } catch {
      // Silently ignore (user may not have manage access)
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const grantAccess = useCallback(async (userId: string | 'all', level: AccessLevel) => {
    if (!channelId) return;
    await api.put(`/access/channels/${channelId}/users/${userId}`, { access_level: level });
    await fetchSettings();
  }, [channelId, fetchSettings]);

  const revokeAccess = useCallback(async (userId: string | 'all') => {
    if (!channelId) return;
    await api.delete(`/access/channels/${channelId}/users/${userId}`);
    await fetchSettings();
  }, [channelId, fetchSettings]);

  const checkConflicts = useCallback(async (
    proposedChange: { removeAllMembersRow?: boolean; removeUserIds?: string[]; addNoAccessUserIds?: string[] }
  ): Promise<PermissionConflict[]> => {
    if (!channelId) return [];
    const { data } = await api.post(`/access/channels/${channelId}/check-conflicts`, proposedChange);
    return data.conflicts;
  }, [channelId]);

  const resolveConflicts = useCallback(async (
    proposedChange: Record<string, unknown>,
    resolutions: ConflictResolution[]
  ) => {
    if (!channelId) return;
    await api.post(`/access/channels/${channelId}/resolve-conflicts`, {
      proposedChange,
      resolutions,
    });
    await fetchSettings();
  }, [channelId, fetchSettings]);

  return { settings, loading, fetchSettings, grantAccess, revokeAccess, checkConflicts, resolveConflicts };
}

export function useConversationPermissions(sessionId: string | null) {
  const [settings, setSettings] = useState<ConversationPermissionSettings | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/access/conversations/${sessionId}`);
      setSettings(data);
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const grantOverride = useCallback(async (userId: string | 'all', level: AccessLevel) => {
    if (!sessionId) return;
    await api.put(`/access/conversations/${sessionId}/users/${userId}`, { access_level: level });
    await fetchSettings();
  }, [sessionId, fetchSettings]);

  const removeOverride = useCallback(async (userId: string | 'all') => {
    if (!sessionId) return;
    await api.delete(`/access/conversations/${sessionId}/users/${userId}`);
    await fetchSettings();
  }, [sessionId, fetchSettings]);

  return { settings, loading, fetchSettings, grantOverride, removeOverride };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/usePermissions.ts
git commit -m "feat: add new permission hooks for 4-level model"
```

---

### Task 7: Create the PermissionLevelSelect component

**Files:**
- Create: `client/src/components/access/PermissionLevelSelect.tsx`

- [ ] **Step 1: Create the reusable permission level dropdown**

```typescript
// client/src/components/access/PermissionLevelSelect.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Shield, Eye, MessageSquare, Settings, Ban } from 'lucide-react';
import type { AccessLevel } from '@/hooks/usePermissions';

interface PermissionLevelSelectProps {
  value: AccessLevel;
  onChange: (level: AccessLevel) => void;
  disabled?: boolean;
  showNoAccess?: boolean; // Whether to include no_access option
  size?: 'sm' | 'default';
}

const LEVEL_CONFIG: Record<AccessLevel, { label: string; icon: typeof Eye; color: string }> = {
  no_access: { label: 'No Access', icon: Ban, color: 'text-red-500' },
  view: { label: 'View', icon: Eye, color: 'text-muted-foreground' },
  reply: { label: 'Reply', icon: MessageSquare, color: 'text-blue-500' },
  manage: { label: 'Manage', icon: Settings, color: 'text-amber-500' },
};

export default function PermissionLevelSelect({
  value,
  onChange,
  disabled = false,
  showNoAccess = true,
  size = 'default',
}: PermissionLevelSelectProps) {
  const levels: AccessLevel[] = showNoAccess
    ? ['no_access', 'view', 'reply', 'manage']
    : ['view', 'reply', 'manage'];

  return (
    <Select value={value} onValueChange={(v) => onChange(v as AccessLevel)} disabled={disabled}>
      <SelectTrigger className={size === 'sm' ? 'h-7 text-xs w-[100px]' : 'w-[130px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => {
          const config = LEVEL_CONFIG[level];
          const Icon = config.icon;
          return (
            <SelectItem key={level} value={level}>
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                <span>{config.label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/components/access/PermissionLevelSelect.tsx
git commit -m "feat: add PermissionLevelSelect component"
```

---

### Task 8: Create the OverrideShieldIcon component

**Files:**
- Create: `client/src/components/inbox/OverrideShieldIcon.tsx`

- [ ] **Step 1: Create the shield indicator component**

```typescript
// client/src/components/inbox/OverrideShieldIcon.tsx
import { Shield } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface OverrideShieldIconProps {
  escalationCount: number;
  restrictionCount: number;
  escalationNames: string[];
  restrictionNames: string[];
  onClick?: (e: React.MouseEvent) => void;
}

function formatNames(names: string[], max: number = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} other${names.length - max > 1 ? 's' : ''}`;
}

function buildTooltip(
  escalationNames: string[],
  restrictionNames: string[],
): string {
  const parts: string[] = [];
  if (escalationNames.length > 0) {
    parts.push(`${formatNames(escalationNames)} have elevated access`);
  }
  if (restrictionNames.length > 0) {
    parts.push(`${formatNames(restrictionNames)} restricted from this conversation`);
  }
  return parts.join('; ');
}

export default function OverrideShieldIcon({
  escalationCount,
  restrictionCount,
  escalationNames,
  restrictionNames,
  onClick,
}: OverrideShieldIconProps) {
  if (escalationCount === 0 && restrictionCount === 0) return null;

  const hasEscalation = escalationCount > 0;
  const hasRestriction = restrictionCount > 0;

  // Determine icon color and arrow indicator
  let colorClass = '';
  let arrow = '';

  if (hasEscalation && hasRestriction) {
    colorClass = 'text-blue-500'; // Mixed — use escalation color as primary
    arrow = '↑↓';
  } else if (hasEscalation) {
    colorClass = 'text-blue-500';
    arrow = '↑';
  } else {
    colorClass = 'text-red-500';
    arrow = '↓';
  }

  const tooltip = buildTooltip(escalationNames, restrictionNames);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={`flex items-center gap-0.5 ${colorClass} hover:opacity-80 transition-opacity`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold leading-none">{arrow}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[250px] text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/OverrideShieldIcon.tsx
git commit -m "feat: add OverrideShieldIcon component for conversation list"
```

---

## Chunk 3: UI Components (AccessManager Rewrite + ConflictResolutionModal)

### Task 9: Rewrite AccessManager for the new permission model

**Files:**
- Modify: `client/src/components/access/AccessManager.tsx`

- [ ] **Step 1: Rewrite AccessManager with inheritance display, override badges, and 4-level support**

The rewrite must support two modes:
1. **Channel mode** — shows sharing mode radio (Private/All team members/Specific people), level dropdown for all-members, per-user level dropdowns, owner badge
2. **Conversation mode** — shows inherited permissions with "from channel" badges (read-only), override entries with "override" badges and ✕ buttons, "+ Add override" button

Key props changes:
```typescript
interface AccessManagerProps {
  mode: 'channel' | 'conversation';
  // Channel mode props
  channelMode?: 'private' | 'specific_users' | 'all_members';
  defaultLevel?: AccessLevel;
  onChannelModeChange?: (mode: string, level?: AccessLevel) => void;
  // Shared props
  permissions: PermissionEntry[];
  inheritedPermissions?: PermissionEntry[]; // For conversation mode
  teamMembers: TeamMember[];
  ownerId?: string;
  onGrant: (userId: string | 'all', level: AccessLevel) => Promise<void>;
  onRevoke: (userId: string | 'all') => Promise<void>;
  onLevelChange?: (userId: string | 'all', level: AccessLevel) => Promise<void>;
  trigger?: React.ReactNode;
  canManage: boolean;
}
```

This is a significant rewrite (~350 lines). Full code will be written during implementation following existing shadcn Dialog + Radix patterns from the current AccessManager.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/components/access/AccessManager.tsx
git commit -m "feat: rewrite AccessManager for 4-level permissions with inheritance"
```

---

### Task 10: Create ConflictResolutionModal

**Files:**
- Create: `client/src/components/access/ConflictResolutionModal.tsx`

- [ ] **Step 1: Create the conflict resolution popup**

```typescript
// client/src/components/access/ConflictResolutionModal.tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { PermissionConflict, ConflictResolution } from '@/hooks/usePermissions';

interface ConflictResolutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: PermissionConflict[];
  onResolve: (resolutions: ConflictResolution[]) => Promise<void>;
}

export default function ConflictResolutionModal({
  open,
  onOpenChange,
  conflicts,
  onResolve,
}: ConflictResolutionModalProps) {
  const [resolutions, setResolutions] = useState<Map<string, 'keep' | 'remove'>>(new Map());
  const [showIndividual, setShowIndividual] = useState(conflicts.length <= 3);
  const [saving, setSaving] = useState(false);

  const totalPeople = conflicts.length;
  const totalConversations = conflicts.reduce((sum, c) => sum + c.sessionIds.length, 0);
  const keepAllNames = conflicts.map((c) => c.userName).slice(0, 3);
  const keepAllExtra = conflicts.length - 3;

  const getResolution = (userId: string): 'keep' | 'remove' => {
    return resolutions.get(userId) || 'keep'; // Default to keep (suggested)
  };

  const setResolutionFor = (userId: string, action: 'keep' | 'remove') => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(userId, action);
      return next;
    });
  };

  const handleApplySuggested = async () => {
    // Apply "keep" for all
    const allKeep: ConflictResolution[] = conflicts.map((c) => ({
      userId: c.userId,
      action: 'keep',
    }));
    setSaving(true);
    try {
      await onResolve(allKeep);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const resolved: ConflictResolution[] = conflicts.map((c) => ({
      userId: c.userId,
      action: getResolution(c.userId),
    }));
    setSaving(true);
    try {
      await onResolve(resolved);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Review access changes
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!showIndividual ? (
            // Bulk view
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {totalConversations} conversation{totalConversations > 1 ? 's' : ''} have custom
                access for {totalPeople} {totalPeople > 1 ? 'people' : 'person'} losing channel access.
              </p>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-sm font-medium">
                  Suggested: Keep all access
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Adds {keepAllNames.join(', ')}
                  {keepAllExtra > 0 ? ` and ${keepAllExtra} other${keepAllExtra > 1 ? 's' : ''}` : ''} to
                  channel with View
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleApplySuggested} disabled={saving} className="flex-1">
                  Apply suggested
                </Button>
                <Button variant="outline" onClick={() => setShowIndividual(true)} className="flex-1">
                  Review individually
                </Button>
              </div>
            </div>
          ) : (
            // Individual view
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {conflicts.map((conflict) => (
                <div key={conflict.userId} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{conflict.userName}</span>
                    <span className="text-xs text-muted-foreground">
                      {conflict.sessionIds.length} conversation{conflict.sessionIds.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`resolve-${conflict.userId}`}
                        checked={getResolution(conflict.userId) === 'keep'}
                        onChange={() => setResolutionFor(conflict.userId, 'keep')}
                        className="accent-primary"
                      />
                      <span>Keep access</span>
                      <span className="text-xs text-muted-foreground">
                        — add to channel with View
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`resolve-${conflict.userId}`}
                        checked={getResolution(conflict.userId) === 'remove'}
                        onChange={() => setResolutionFor(conflict.userId, 'remove')}
                        className="accent-primary"
                      />
                      <span>Remove access</span>
                      <span className="text-xs text-muted-foreground">
                        — {conflict.userName} loses access
                      </span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showIndividual && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>Save changes</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/components/access/ConflictResolutionModal.tsx
git commit -m "feat: add ConflictResolutionModal component"
```

---

## Chunk 4: Integration (Wire Everything Together)

### Task 11: Update ChannelDetailView to use new permissions

**Files:**
- Modify: `client/src/components/settings/ChannelDetailView.tsx`

- [ ] **Step 1: Replace useChannelAccess with useChannelPermissions**

Update imports, replace the old hook usage, and pass new props to AccessManager. The channel settings "Access" tab should now show:
- Radio: Private / All team members / Specific people
- "All team members" gets a level dropdown (View/Reply/Manage)
- Per-user rows with PermissionLevelSelect
- Owner row always visible, non-editable
- Mode switching triggers conflict check → ConflictResolutionModal if needed

- [ ] **Step 2: Wire up ConflictResolutionModal**

Add state for `conflicts` and `conflictModalOpen`. When the user changes the channel mode, call `checkConflicts()` first. If conflicts found, show the modal. On resolve, call `resolveConflicts()`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add client/src/components/settings/ChannelDetailView.tsx
git commit -m "feat: update ChannelDetailView for new 4-level permissions"
```

---

### Task 12: Update ConversationHeader to use new permissions

**Files:**
- Modify: `client/src/components/inbox/ConversationHeader.tsx`

- [ ] **Step 1: Replace useConversationAccess with useConversationPermissions**

Update the import and hook usage. Pass new props to AccessManager in conversation mode:
- `mode="conversation"`
- `inheritedPermissions` from the channel
- `permissions` for conversation-level overrides
- `canManage` based on user's resolved access level

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/ConversationHeader.tsx
git commit -m "feat: update ConversationHeader for new permissions"
```

---

### Task 13: Add shield indicators and context menu to conversation list

**Files:**
- Modify: `client/src/hooks/useConversations.ts`
- Modify: `client/src/components/inbox/ConversationItem.tsx`
- Modify: `client/src/components/inbox/ConversationContextMenu.tsx`

- [ ] **Step 1: Add override metadata to the Conversation type and fetch**

In `useConversations.ts`, extend the `Conversation` interface:
```typescript
overrideMeta?: {
  escalationCount: number;
  restrictionCount: number;
  escalationNames: string[];
  restrictionNames: string[];
};
```

After fetching conversations, make a second call to get override metadata for the returned session IDs and merge into the conversation objects.

- [ ] **Step 2: Add OverrideShieldIcon to ConversationItem**

In `ConversationItem.tsx`, import OverrideShieldIcon and render it next to the timestamp when `conversation.overrideMeta` has counts > 0. Pass an `onClick` handler that opens the access panel.

- [ ] **Step 3: Add "Manage access" to ConversationContextMenu**

In `ConversationContextMenu.tsx`, add a new menu item:
```tsx
<ContextMenuItem onClick={() => onManageAccess(conversation.id)}>
  <Shield className="mr-2 h-4 w-4" />
  Manage access
</ContextMenuItem>
```

This requires threading an `onManageAccess` callback through from InboxPage.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useConversations.ts client/src/components/inbox/ConversationItem.tsx client/src/components/inbox/ConversationContextMenu.tsx
git commit -m "feat: add shield indicators and 'Manage access' context menu"
```

---

### Task 14: Clean up old code

**Files:**
- Modify: `server/src/services/accessControl.ts` (mark deprecated or remove)
- Modify: `client/src/hooks/useAccessControl.ts` (mark deprecated or remove)
- Create: `supabase/migrations/060_drop_old_access_tables.sql`

- [ ] **Step 1: Remove old channel/conversation access code from accessControl.ts**

Search all server files that import channel/conversation access functions from `accessControl.ts` and update them to use `permissionResolver.ts`. **Do NOT delete `accessControl.ts`** — it still contains `getContactAccess()` which is used by the contact access system (out of scope). Instead, remove only the channel/conversation functions from it and keep `getContactAccess` intact.

- [ ] **Step 2: Remove old channel/conversation hooks from useAccessControl.ts**

Search all client files that import `useChannelAccess` or `useConversationAccess` from `useAccessControl.ts` and update them to use `usePermissions.ts`. **Do NOT delete `useAccessControl.ts`** — it still contains `useContactAccess()` which is used by the contact access UI (out of scope). Instead, remove only the channel/conversation hooks and keep `useContactAccess` intact.

- [ ] **Step 3: Create the drop-old-tables migration**

```sql
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
```

- [ ] **Step 4: Verify full build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove old access control code and add cleanup migration (060)"
```

---

### Task 15: Update plans/INDEX.md and WORKBOARD.md

**Files:**
- Modify: `plans/INDEX.md`

- [ ] **Step 1: Add this plan to INDEX.md**

Add a new row for the access permissions redesign plan.

- [ ] **Step 2: Commit**

```bash
git add plans/INDEX.md
git commit -m "docs: add access permissions redesign to plans index"
```

---

## Summary

| Chunk | Tasks | What It Delivers |
|-------|-------|-----------------|
| 1: DB + Resolver | Tasks 1-5 | New schema, permission resolution, conflict detection, updated routes and filtering |
| 2: Hooks + Components | Tasks 6-8 | New React hooks, PermissionLevelSelect, OverrideShieldIcon |
| 3: UI Rewrite | Tasks 9-10 | Rewritten AccessManager, ConflictResolutionModal |
| 4: Integration | Tasks 11-15 | Wire everything together, update all consuming components, clean up old code |

**Dependency order:** Chunk 1 → Chunk 2 → Chunk 3 → Chunk 4 (sequential — each chunk depends on the previous).
