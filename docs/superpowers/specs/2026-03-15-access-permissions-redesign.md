# Access & Permissions Redesign — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Channel and conversation permissions. Contacts excluded (future work).

---

## Overview

Redesign the access control system to support:
- 4 permission levels: No Access, View, Reply, Manage
- Bidirectional conversation overrides (escalate OR restrict relative to channel)
- Live inheritance from channel → conversation (not snapshot)
- Smart conflict resolution when channel changes affect conversation overrides
- Clear, transparent UI with visible inheritance and override indicators

## 1. Data Model

### Postgres Enum

```sql
CREATE TYPE access_level AS ENUM ('no_access', 'view', 'reply', 'manage');
```

Ordered from least to most permissive.

### `channel_permissions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `channel_id` | BIGINT FK → whatsapp_channels | ON DELETE CASCADE |
| `user_id` | UUID FK → users, **nullable** | NULL = "all team members" entry |
| `access_level` | access_level ENUM | no_access / view / reply / manage |
| `granted_by` | UUID FK → users | Who set this |
| `company_id` | UUID FK → companies | Denormalized for efficient RLS |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Unique constraints (handling nullable user_id):**
```sql
-- For non-null user_id rows: one entry per user per channel
CREATE UNIQUE INDEX idx_channel_perm_unique_user
  ON channel_permissions(channel_id, user_id) WHERE user_id IS NOT NULL;

-- For null user_id rows: one "all members" entry per channel
CREATE UNIQUE INDEX idx_channel_perm_unique_all
  ON channel_permissions(channel_id) WHERE user_id IS NULL;
```

**How channel modes map to data (no `sharing_mode` column):**
- **Private:** No rows. Only owner has access.
- **Specific people:** Individual rows with specific user_ids and levels.
- **All team members:** One row with `user_id = NULL` and the chosen level (View/Reply/Manage). Individual rows can override this — including `no_access` to block specific users while the channel is otherwise open.

### `conversation_permissions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `session_id` | UUID FK → chat_sessions | ON DELETE CASCADE |
| `user_id` | UUID FK → users, **nullable** | NULL = "all channel users" entry |
| `access_level` | access_level ENUM | no_access / view / reply / manage |
| `granted_by` | UUID FK → users | Who set this |
| `company_id` | UUID FK → companies | Denormalized for efficient RLS |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Unique constraints (handling nullable user_id):**
```sql
-- For non-null user_id rows: one entry per user per conversation
CREATE UNIQUE INDEX idx_conv_perm_unique_user
  ON conversation_permissions(session_id, user_id) WHERE user_id IS NOT NULL;

-- For null user_id rows: one "all channel users" entry per conversation
CREATE UNIQUE INDEX idx_conv_perm_unique_all
  ON conversation_permissions(session_id) WHERE user_id IS NULL;
```

**Inheritance:**
- No rows = inherit from channel (default).
- Rows exist = overrides. NULL user_id = override for all channel users.

### `whatsapp_channels` changes

- **Remove:** `sharing_mode`, `default_conversation_visibility`
- **Keep:** `user_id` (owner — permanent `manage`, irrevocable, not stored in `channel_permissions`)

### Indexes

```sql
CREATE INDEX idx_channel_perm_channel ON channel_permissions(channel_id);
CREATE INDEX idx_channel_perm_user ON channel_permissions(user_id);
CREATE INDEX idx_channel_perm_company ON channel_permissions(company_id);
CREATE INDEX idx_conversation_perm_session ON conversation_permissions(session_id);
CREATE INDEX idx_conversation_perm_user ON conversation_permissions(user_id);
CREATE INDEX idx_conv_perm_company ON conversation_permissions(company_id);
CREATE INDEX idx_conv_perm_user_level ON conversation_permissions(user_id, access_level);
```

## 2. Permission Resolution Logic

### Level Hierarchy

```
no_access (0) < view (1) < reply (2) < manage (3)
```

### Resolving Channel Access

```
getChannelAccess(userId, channelId) → access_level | null

1. If userId === channel.user_id → return 'manage' (owner, always)
2. Look up channel_permissions where channel_id AND user_id = userId
   → If found, return that access_level
3. Look up channel_permissions where channel_id AND user_id = NULL
   → If found, return that access_level
4. Return null (no access)
```

Specific user entry (step 2) always beats the all-members entry (step 3).

### Resolving Conversation Access

```
getConversationAccess(userId, channelId, sessionId) → access_level | null

1. If userId === channel.user_id → return 'manage' (owner always has manage everywhere)
2. channelAccess = getChannelAccess(userId, channelId)
3. If channelAccess is null → return null (channel is the gateway)
4. If channelAccess is 'no_access' → return 'no_access'
5. Look up conversation_permissions where session_id AND user_id = userId
   → If found, return that access_level (override replaces)
6. Look up conversation_permissions where session_id AND user_id = NULL
   → If found, return that access_level (all-users override)
7. Return channelAccess (inherit from channel)
```

**Owner protection:** Step 1 ensures the channel owner always gets `manage` on every conversation, regardless of any conversation-level overrides. No conversation override can lock out the channel owner.

**Channel gateway rule:** Steps 3-4 ensure that users with no channel access or `no_access` at channel level cannot access any conversations, even if conversation-level overrides exist for them. Conversation overrides for users with `no_access` at channel level are **inert** — they exist in the database but produce no effect. The UI must prevent creating conversation overrides for users who have `no_access` or null at the channel level (see Section 4.2).

**Override replaces, not "most restrictive wins."** This enables bidirectional overrides:

| Channel | Conv Override | Result | Direction |
|---------|-------------|--------|-----------|
| Reply | Manage | **Manage** | Escalation ↑ |
| Reply | View | **View** | Restriction ↓ |
| Reply | No Access | **No Access** | Full block ↓ |
| Reply | *(none)* | **Reply** | Inheritance |
| null | *(anything)* | **null** | No channel access |

### Permission Level Capabilities

| Level | See messages | Send messages | Change access settings |
|-------|------------|--------------|----------------------|
| no_access | No | No | No |
| view | Yes | No | No |
| reply | Yes | Yes | No |
| manage | Yes | Yes | Yes |

### Who Can Manage What

- `manage` on a channel → can manage channel settings AND set conversation overrides for conversations in that channel
- `manage` on a conversation → can manage that conversation's overrides
- Owner = permanent irrevocable `manage` on their channel and ALL conversations in it

### Filtering the Conversation List

```
getAccessibleSessions(userId, companyId) →
  { channelIds: [...], excludedSessionIds: [...], overrideMeta: [...] }

1. Get all channel_ids where user has access (not null, not no_access)

2. Get all conversation_permissions where access_level = 'no_access'
   AND (user_id = :userId OR user_id IS NULL)
   → candidateExclusions
   This catches both user-specific blocks AND all-channel-users blocks.

3. For each candidateExclusion, resolve whether the user is actually blocked:
   - If session has user_id=userId with no_access → user IS blocked
     (specific beats null, even if a NULL row grants higher access)
   - If session has user_id=NULL with no_access AND user_id=userId with > no_access
     → do NOT exclude (specific override reinstates access)
   - If session has user_id=NULL with no_access AND no user-specific row exists
     → user IS blocked, add to excludedSessionIds

   **Note:** A user-specific `no_access` override blocks the user even if
   a NULL-user override is more permissive. Specific always beats general.

4. Get override metadata for shield indicators:
   Fetch conversation_permissions for conversations in the CURRENT PAGE/BATCH only
   (not all conversations in all accessible channels — that would be expensive).
   Group by session_id with counts of escalations and restrictions.
   → overrideMeta (sessionId, escalationCount, restrictionCount, names)
   The client passes the visible session_ids, server returns override metadata
   for just those conversations.

5. Query: WHERE channel_id IN (:channelIds)
          AND session_id NOT IN (:excludedSessionIds)
```

The `overrideMeta` is returned alongside the conversation list so the client can render shield indicators without a separate fetch.

> **Known approximation:** Escalation/restriction in shield indicators is determined by comparing each conversation override against the channel's all-members default level. Ideally we'd compare against each user's specific channel access, but that requires N user lookups per conversation. The all-members default is a reasonable approximation for the summary indicator. The full per-user comparison happens in the conversation access panel.

### Assignment Behavior

When a user is assigned to a conversation via the assignment system:
- If the user already has `reply` or `manage` access (from channel or override) → no change needed
- If the user has `view` or `no_access` on the conversation → auto-create a conversation override with `reply` level
- If the user has no channel access → do NOT auto-create (assignment does not bypass the channel gateway; the assigner should add the user to the channel first)
- Auto-created overrides use `ON CONFLICT DO UPDATE SET access_level = 'reply'` — assignment DOES upgrade existing lower overrides, unlike the old system

## 3. Conflict Resolution System

### When It Triggers

On any channel permission change that **removes channel access entirely** for users who have conversation overrides. Downgrades don't trigger it (overrides replace, not combine).

| Channel Change | Triggers Popup? |
|---|---|
| Remove a user from channel | Yes, if they have conv overrides |
| Downgrade a user's level | No |
| Remove the all-members row | Yes, if non-listed users have conv overrides |
| Change all-members level | No |
| Add `no_access` for a specific user | Yes, if they have conv overrides (user goes from implicit all-members access to explicit no_access) |

### Conflict Detection

```
detectConflicts(channelId, proposedChange) → Conflict[]

1. Compute which user_ids will LOSE channel access after the change.
   This includes:
   a. Users being explicitly removed from channel_permissions
   b. Users who currently have access via the all-members row (user_id=NULL)
      but will lose it because the all-members row is being removed
      and they have no individual channel_permissions row
   c. Users who currently have access via the all-members row
      but are getting an explicit no_access override added

2. For each affected user_id, find all conversation_permissions
   where session_id belongs to this channel
   AND (user_id = affected_user_id AND access_level != 'no_access')
   → These are overrides that will become inert

3. Each match is a Conflict with: sessionId, userId, userName,
   currentConvLevel, currentChannelLevel, proposedChannelLevel
```

### User-Facing Popup

**Two options per conflict: Keep access / Remove access.**

- **Keep access:** System adds the user to the channel at `view` (minimum needed for conv override to work)
- **Remove access:** Deletes the conversation override, user loses access

**Bulk mode (>3 conflicts):**
```
"3 conversations have custom access for people losing channel access."
Suggested: Keep all access (adds Carol, Dan to channel with View)
[Apply suggested]  [Review individually →]
```

**Individual review:**
Grouped by person (not by conversation):
```
Carol Lee — 4 conversations
○ Keep access (add to channel with View)
○ Remove access

Dan Smith — 1 conversation
○ Keep access (add to channel with View)
○ Remove access
```

**Atomicity:** All decisions applied in a single transaction — channel changes + channel additions + override deletions.

**No contradictions:** Every option leads to a valid state. There is no "keep as-is with a warning."

## 4. UI/UX Components

### 4.1 Channel Access Settings (Settings Page)

Single unified panel replacing the old two-section layout.

- Radio buttons: Private / All team members / Specific people
- "All team members" has a **level dropdown** next to it (View / Reply / Manage)
- "Specific people" — people list with individual level dropdowns (No Access / View / Reply / Manage)
- When "All team members" selected, individual people can still be listed with different levels — **including `no_access`** to block specific users while the channel is otherwise open. The per-user dropdown shows all four levels.
- Owner row always visible, always "Manage", non-editable, tagged `[owner]`
- Switching modes triggers conflict resolution popup if needed

### 4.2 Conversation Access Panel

Opened via: header icon, clickable shield in list, or right-click context menu.

**Default state (inheriting):**
- Shows all inherited permissions with "from channel" badge (subtle, muted)
- Read-only appearance
- "+ Add override" button at bottom

**With overrides:**
- Override rows show "override" badge in accent color with ✕ to remove
- No Access shown in red text
- Escalations shown in blue text
- Clicking ✕ removes override, person falls back to inheritance

**"Add override" flow:**
1. Click "+ Add override"
2. Search/select a person — **only people who have channel access (not null, not no_access) are shown**. Users with `no_access` or no channel access are excluded from the picker because conversation overrides for them would be inert.
3. Pick level: No Access / View / Reply / Manage
4. Save — row appears with "override" badge

**Clicking an inherited person:** Opens inline dropdown to set an override. Picking same level as channel creates no override.

### 4.3 Conversation List Indicators

Shield + arrow icons next to timestamp:

| State | Icon | Color |
|---|---|---|
| Escalation overrides only | 🛡↑ | Blue (#4facfe) |
| Restriction overrides only | 🛡↓ | Red (#e06060) |
| Both | 🛡↑↓ | Blue + Red |
| No overrides | *(none)* | — |

**Tooltips:** Show specific names, max 3 + "and X others."
- Escalation: "Carol, Dan have elevated access"
- Restriction: "Eve is restricted from this conversation"
- Mixed: "Carol elevated; Eve, Frank restricted"

**Click behavior:** Opens conversation access panel.

### 4.4 Right-Click Context Menu

New entry: "🛡 Manage access" — opens conversation access panel.

### 4.5 Copywriting

| Element | Copy |
|---|---|
| Inherited badge | `from channel` |
| Override badge | `override` |
| Owner tag | `owner` |
| Add button | `+ Add override` |
| Escalation tooltip | `{names} have elevated access` |
| Restriction tooltip | `{names} restricted from this conversation` |
| Conflict popup title | `Review access changes` |
| Keep option | `Keep access — add {name} to channel with View` |
| Remove option | `Remove access — {name} loses access` |

## 5. Migration Strategy

### Approach: Clean Rebuild

New tables created alongside old ones. Data migrated. Old tables dropped after verification.

### Level Mapping

| Old Level | New Level | Rationale |
|---|---|---|
| `view` | `view` | Same meaning |
| `edit` | `reply` | Old "edit" = send messages, NOT manage access |
| owner | `manage` | Via `whatsapp_channels.user_id` (implicit, not in table) |

### Migration Steps

**Step 1: Create new schema** — enum + tables alongside old ones.

**Step 2: Migrate channel data:**
- `all_members` channels → insert `user_id = NULL, access_level = 'reply'`
- `specific_users` channels → insert per-user rows (`edit` → `reply`, `view` → `view`)
- `private` channels → no rows
- Populate `company_id` from `whatsapp_channels.company_id` join

**Step 3: Migrate conversation data:**
- Migrate `conversation_access` rows (`edit` → `reply`, `view` → `view`, NULL user_id preserved)
- For `owner_only` channels: only conversations that have **at least one explicit grant** need migration. For those conversations, insert `user_id = NULL, access_level = 'no_access'` to block non-granted users, plus migrate the individual grants. Conversations with zero grants in `owner_only` channels also get `user_id = NULL, access_level = 'no_access'` — but ONLY if the channel has non-owner users with access (otherwise there's no one to block, skip the row).
- Populate `company_id` from channel join

**Step 4: Update application code** — rewrite `accessControl.ts`, API routes, UI components, RLS policies.

**Step 5: Verify** — test all scenarios in the permission resolution matrix. Confirm no regressions.

**Step 6: Drop old schema** (separate migration) — `channel_access`, `conversation_access` tables; `sharing_mode`, `default_conversation_visibility` columns. This is a separate migration so it can be rolled back independently.

### Rollback Plan

Old and new tables coexist during migration. If issues arise, revert application code to old tables. New tables can be dropped without data loss.

## 6. RLS Policies

All permission tables have Row-Level Security enabled. The denormalized `company_id` column enables efficient single-table policies.

**Important:** The full permission resolution logic (channel owner check → channel_permissions lookup → conversation_permissions lookup) is too complex to express as raw SQL in RLS policies without helper functions or performance issues. Therefore:

- **Primary enforcement:** API route layer checks permissions using the `getChannelAccess` / `getConversationAccess` functions before any write operation. Server uses `supabaseAdmin` (service role) which bypasses RLS.
- **RLS as safety net:** Simplified policies that prevent cross-company data leakage but do NOT replicate the full manage-level check.

### `channel_permissions` RLS

- **SELECT:** `company_id` matches the user's company (via join to `users.company_id` or a helper function)
- **INSERT/UPDATE/DELETE:** Same company check. Full manage-level authorization is enforced at the API layer.

### `conversation_permissions` RLS

- **SELECT:** `company_id` matches the user's company
- **INSERT/UPDATE/DELETE:** Same company check. Full manage-level authorization is enforced at the API layer.

### `updated_at` Triggers

Both tables require a `set_updated_at` trigger (matching the pattern in migration 038):
```sql
CREATE TRIGGER set_channel_perm_updated_at
  BEFORE UPDATE ON channel_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_conv_perm_updated_at
  BEFORE UPDATE ON conversation_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## 7. Out of Scope

- **Contact permissions** — contacts stay on old system (`private / specific_users / all_members` with `view / edit`). Future work with a contact-appropriate model (likely `no_access / view / edit / manage`).
- **Notification changes** — access changes may need to trigger notifications (e.g., "You've been given access to..."). Deferred.
- **Audit log** — tracking who changed what access when. Deferred.
- **Bulk conversation override management** — e.g., "set all conversations in this channel to X." Deferred.
- **Realtime permission updates** — when a user's permission changes while they're viewing a conversation (e.g., reply box should disable if downgraded to view). Deferred but important for polish.

## 8. Implementation Notes

### Single-Query Optimization for Override Resolution

The pseudocode in Section 2 separates user-specific and NULL lookups into sequential steps for clarity. In implementation, use a single query with ordering (as the current codebase does in `accessControl.ts` line 93-95):

```sql
SELECT access_level FROM conversation_permissions
WHERE session_id = :sessionId AND (user_id = :userId OR user_id IS NULL)
ORDER BY user_id DESC NULLS LAST
LIMIT 1;
```

This returns the user-specific row if it exists, otherwise the NULL row, in one round-trip.

### `getConversationAccess` Specificity Rule

A user-specific `no_access` override blocks the user even if a NULL-user override is more permissive. Specific always beats general. This is consistent with the channel-level behavior (specific user row beats all-members row). Implementers should not assume the NULL row acts as a floor.

## 9. Key Files to Create/Modify

| File | Action |
|---|---|
| `supabase/migrations/XXX_permissions_redesign.sql` | New migration: enum, tables, indexes, RLS policies, data migration, drop old |
| `server/src/services/accessControl.ts` | Complete rewrite with new resolution logic |
| `server/src/services/conflictDetection.ts` | New: conflict detection algorithm |
| `server/src/routes/access.ts` | Rewrite to use new tables + conflict resolution endpoints |
| `client/src/hooks/useAccessControl.ts` | Rewrite hooks for new API shape |
| `client/src/components/access/AccessManager.tsx` | Rewrite with new UI (badges, overrides, levels) |
| `client/src/components/access/ConflictResolutionModal.tsx` | New: smart popup |
| `client/src/components/settings/ChannelDetailView.tsx` | Update channel settings UI |
| `client/src/components/inbox/ConversationHeader.tsx` | Update header icon behavior |
| `client/src/components/inbox/ConversationList.tsx` (or equivalent) | Add shield indicators, right-click menu, override metadata |
