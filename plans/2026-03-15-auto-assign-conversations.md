# Auto-Assign Conversations

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically assign new incoming conversations to team members based on configurable per-channel rules: round-robin, least-busy, or tag-based routing, with availability toggles for team members.

**Architecture:** New `auto_assign_rules` table stores one rule per channel with a strategy type. New `auto_assign_members` table stores the assignable member pool per rule with availability status. Assignment logic runs server-side when a new `chat_session` is created (in the message processor). A settings UI allows configuring rules per channel. An availability toggle is exposed in the sidebar for quick access.

**Tech Stack:** Supabase (Postgres migration, RLS), Express routes, React (shadcn UI), server-side service for assignment logic

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/051_auto_assign.sql` | Migration: create auto_assign_rules and auto_assign_members tables |
| Create | `server/src/routes/autoAssign.ts` | CRUD API for rules and member availability |
| Create | `server/src/services/autoAssignService.ts` | Core assignment logic (round-robin, least-busy, tag-based) |
| Modify | `server/src/index.ts` | Register autoAssign route |
| Modify | `server/src/services/messageProcessor.ts` | Call auto-assign on new session creation |
| Create | `client/src/hooks/useAutoAssignRules.ts` | Data-fetching hook for auto-assign rules |
| Create | `client/src/components/settings/AutoAssignSettings.tsx` | Settings UI for configuring rules |
| Modify | `client/src/pages/SettingsPage.tsx` | Add Auto-Assign tab/section |
| Modify | `client/src/components/layout/AppLayout.tsx` or sidebar | Add availability toggle |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/051_auto_assign.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Auto-assign rules: one per channel (or company-wide if channel_id is null)
CREATE TABLE auto_assign_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id BIGINT REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL CHECK (strategy IN ('round_robin', 'least_busy', 'tag_based')),
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, channel_id)
);

-- For company-wide rule (channel_id = null), need partial unique index
CREATE UNIQUE INDEX idx_auto_assign_rules_company_default
  ON auto_assign_rules (company_id)
  WHERE channel_id IS NULL;

-- Member pool: who can be auto-assigned per rule
CREATE TABLE auto_assign_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES auto_assign_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  last_assigned_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, user_id)
);

-- Indexes
CREATE INDEX idx_auto_assign_rules_company ON auto_assign_rules (company_id);
CREATE INDEX idx_auto_assign_rules_channel ON auto_assign_rules (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX idx_auto_assign_members_rule ON auto_assign_members (rule_id);
CREATE INDEX idx_auto_assign_members_user ON auto_assign_members (user_id);
CREATE INDEX idx_auto_assign_members_available ON auto_assign_members (rule_id, is_available, last_assigned_at)
  WHERE is_available = true;

-- RLS
ALTER TABLE auto_assign_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_assign_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY auto_assign_rules_select ON auto_assign_rules FOR SELECT USING (
  company_id = public.get_user_company_id()
);
CREATE POLICY auto_assign_rules_insert ON auto_assign_rules FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);
CREATE POLICY auto_assign_rules_update ON auto_assign_rules FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);
CREATE POLICY auto_assign_rules_delete ON auto_assign_rules FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND public.has_permission('channels', 'edit')
);

CREATE POLICY auto_assign_members_select ON auto_assign_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM auto_assign_rules r
    WHERE r.id = auto_assign_members.rule_id
    AND r.company_id = public.get_user_company_id()
  )
);
CREATE POLICY auto_assign_members_all ON auto_assign_members FOR ALL USING (
  EXISTS (
    SELECT 1 FROM auto_assign_rules r
    WHERE r.id = auto_assign_members.rule_id
    AND r.company_id = public.get_user_company_id()
    AND public.has_permission('channels', 'edit')
  )
);

-- Add default permission for auto_assign management (reuse 'channels' resource)
-- No new permission needed — we reuse channels.edit for managing auto-assign rules
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/051_auto_assign.sql
git commit -m "feat: add auto_assign_rules and auto_assign_members tables"
```

---

## Task 2: Auto-Assign Service (Core Logic)

**Files:**
- Create: `server/src/services/autoAssignService.ts`

- [ ] **Step 1: Create the service file with strategy implementations**

```typescript
import { supabaseAdmin } from '../config/supabase.js';

interface AutoAssignResult {
  assignedTo: string | null;
  ruleName: string | null;
}

/**
 * Determine who to assign a new conversation to based on the channel's auto-assign rule.
 * Returns null if no rule applies or no members are available.
 */
export async function autoAssignConversation(
  companyId: string,
  channelId: number,
  contactTags: string[]
): Promise<AutoAssignResult> {
  // Find applicable rule: channel-specific first, then company-wide fallback
  const { data: rule } = await supabaseAdmin
    .from('auto_assign_rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .order('channel_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!rule) return { assignedTo: null, ruleName: null };

  // Get available members for this rule
  const { data: members } = await supabaseAdmin
    .from('auto_assign_members')
    .select('*')
    .eq('rule_id', rule.id)
    .eq('is_available', true);

  if (!members || members.length === 0) return { assignedTo: null, ruleName: null };

  let assignedUserId: string | null = null;

  switch (rule.strategy) {
    case 'round_robin':
      assignedUserId = await roundRobin(members);
      break;
    case 'least_busy':
      assignedUserId = await leastBusy(members, companyId);
      break;
    case 'tag_based':
      assignedUserId = await tagBased(members, contactTags, rule.config);
      break;
  }

  if (assignedUserId) {
    // Update last_assigned_at for round-robin tracking
    await supabaseAdmin
      .from('auto_assign_members')
      .update({ last_assigned_at: new Date().toISOString() })
      .eq('rule_id', rule.id)
      .eq('user_id', assignedUserId);
  }

  return { assignedTo: assignedUserId, ruleName: rule.strategy };
}

/**
 * Round-robin: assign to the available member who was assigned longest ago (or never).
 */
async function roundRobin(
  members: { user_id: string; last_assigned_at: string | null }[]
): Promise<string | null> {
  // Sort: null (never assigned) first, then oldest last_assigned_at
  const sorted = [...members].sort((a, b) => {
    if (!a.last_assigned_at && !b.last_assigned_at) return 0;
    if (!a.last_assigned_at) return -1;
    if (!b.last_assigned_at) return 1;
    return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
  });
  return sorted[0]?.user_id ?? null;
}

/**
 * Least-busy: assign to the available member with the fewest open conversations.
 */
async function leastBusy(
  members: { user_id: string }[],
  companyId: string
): Promise<string | null> {
  const userIds = members.map((m) => m.user_id);

  // Count open conversations per member
  const { data: counts } = await supabaseAdmin
    .from('chat_sessions')
    .select('assigned_to')
    .eq('company_id', companyId)
    .in('assigned_to', userIds)
    .in('status', ['open', 'pending']);

  const countMap = new Map<string, number>();
  for (const uid of userIds) countMap.set(uid, 0);
  for (const row of counts || []) {
    if (row.assigned_to) {
      countMap.set(row.assigned_to, (countMap.get(row.assigned_to) || 0) + 1);
    }
  }

  // Find member with fewest open conversations
  let minCount = Infinity;
  let minUser: string | null = null;
  for (const [userId, count] of countMap) {
    if (count < minCount) {
      minCount = count;
      minUser = userId;
    }
  }
  return minUser;
}

/**
 * Tag-based: match contact tags to configured routes.
 * Falls back to round-robin if no tag matches.
 *
 * config.tag_routes: Array<{ tag: string; user_id: string }>
 * config.fallback_strategy: 'round_robin' | 'least_busy' (defaults to 'round_robin')
 */
async function tagBased(
  members: { user_id: string; last_assigned_at: string | null }[],
  contactTags: string[],
  config: { tag_routes?: { tag: string; user_id: string }[]; fallback_strategy?: string }
): Promise<string | null> {
  const routes = config.tag_routes || [];
  const availableUserIds = new Set(members.map((m) => m.user_id));

  // Check each contact tag against routes
  for (const contactTag of contactTags) {
    const route = routes.find((r) => r.tag.toLowerCase() === contactTag.toLowerCase());
    if (route && availableUserIds.has(route.user_id)) {
      return route.user_id;
    }
  }

  // Fallback
  return roundRobin(members);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/autoAssignService.ts
git commit -m "feat: add auto-assign service with round-robin, least-busy, tag-based strategies"
```

---

## Task 3: Auto-Assign API Routes

**Files:**
- Create: `server/src/routes/autoAssign.ts`
- Modify: `server/src/index.ts` — register the route

- [ ] **Step 1: Create the route file**

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List rules for company (with members)
router.get('/rules', requirePermission('channels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { data, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .select('*, members:auto_assign_members(*, user:user_id(id, full_name, avatar_url))')
      .eq('company_id', companyId)
      .order('created_at');

    if (error) throw error;
    res.json({ rules: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create rule
router.post('/rules', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channel_id, strategy, config, member_ids } = req.body;

    if (!strategy || !['round_robin', 'least_busy', 'tag_based'].includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    const { data: rule, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .insert({
        company_id: companyId,
        channel_id: channel_id || null,
        strategy,
        config: config || {},
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A rule already exists for this channel' });
        return;
      }
      throw error;
    }

    // Add members if provided
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      await supabaseAdmin
        .from('auto_assign_members')
        .insert(member_ids.map((uid: string) => ({ rule_id: rule.id, user_id: uid })));
    }

    res.json({ rule });
  } catch (err) {
    next(err);
  }
});

// Update rule
router.put('/rules/:ruleId', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { ruleId } = req.params;
    const { strategy, config, is_active, member_ids } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (strategy) updates.strategy = strategy;
    if (config !== undefined) updates.config = config;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .update(updates)
      .eq('id', ruleId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    // Sync members if provided
    if (Array.isArray(member_ids)) {
      // Remove all existing members
      await supabaseAdmin
        .from('auto_assign_members')
        .delete()
        .eq('rule_id', ruleId);

      // Add new members
      if (member_ids.length > 0) {
        await supabaseAdmin
          .from('auto_assign_members')
          .insert(member_ids.map((uid: string) => ({ rule_id: ruleId, user_id: uid })));
      }
    }

    res.json({ rule: data });
  } catch (err) {
    next(err);
  }
});

// Delete rule
router.delete('/rules/:ruleId', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { ruleId } = req.params;

    await supabaseAdmin
      .from('auto_assign_rules')
      .delete()
      .eq('id', ruleId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Toggle member availability
router.patch('/members/:memberId/availability', requireAuth, async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { is_available } = req.body;

    // Members can toggle their own availability
    const { data, error } = await supabaseAdmin
      .from('auto_assign_members')
      .update({ is_available })
      .eq('id', memberId)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Member not found or not authorized' });
      return;
    }

    res.json({ member: data });
  } catch (err) {
    next(err);
  }
});

// Get current user's availability status across all rules
router.get('/my-availability', requireAuth, async (req, res, next) => {
  try {
    const { data } = await supabaseAdmin
      .from('auto_assign_members')
      .select('id, rule_id, is_available')
      .eq('user_id', req.userId);

    const isAvailable = (data || []).every((m) => m.is_available);
    res.json({ is_available: isAvailable, memberships: data || [] });
  } catch (err) {
    next(err);
  }
});

// Toggle current user's availability across all rules
router.patch('/my-availability', requireAuth, async (req, res, next) => {
  try {
    const { is_available } = req.body;

    await supabaseAdmin
      .from('auto_assign_members')
      .update({ is_available })
      .eq('user_id', req.userId);

    res.json({ is_available });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register route in server/src/index.ts**

Add to the imports and route registrations:
```typescript
import autoAssignRoutes from './routes/autoAssign.js';
// ...
app.use('/api/auto-assign', autoAssignRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/autoAssign.ts server/src/index.ts
git commit -m "feat: add auto-assign API routes"
```

---

## Task 4: Wire Auto-Assign into Message Processor

**Files:**
- Modify: `server/src/services/messageProcessor.ts`

- [ ] **Step 1: Identify where new chat sessions are created**

Search `messageProcessor.ts` for where a new `chat_session` is inserted (look for `.insert` on `chat_sessions`). This is where auto-assign should fire.

- [ ] **Step 2: Add auto-assign call after session creation**

After a new session is created with `assigned_to = null`, call the auto-assign service:

```typescript
import { autoAssignConversation } from './autoAssignService.js';

// After session creation:
if (!newSession.assigned_to) {
  // Get contact tags for tag-based routing
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('tags')
    .eq('id', newSession.contact_id)
    .single();

  const result = await autoAssignConversation(
    companyId,
    newSession.channel_id,
    contact?.tags || []
  );

  if (result.assignedTo) {
    await supabaseAdmin
      .from('chat_sessions')
      .update({ assigned_to: result.assignedTo })
      .eq('id', newSession.id);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/messageProcessor.ts
git commit -m "feat: wire auto-assign into message processor for new conversations"
```

---

## Task 5: Auto-Assign Settings UI

**Files:**
- Create: `client/src/hooks/useAutoAssignRules.ts`
- Create: `client/src/components/settings/AutoAssignSettings.tsx`
- Modify: `client/src/pages/SettingsPage.tsx` — add the new section

- [ ] **Step 1: Create the data-fetching hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface AutoAssignMember {
  id: string;
  user_id: string;
  is_available: boolean;
  last_assigned_at: string | null;
  user: { id: string; full_name: string; avatar_url: string | null };
}

export interface AutoAssignRule {
  id: string;
  channel_id: number | null;
  strategy: 'round_robin' | 'least_busy' | 'tag_based';
  config: Record<string, unknown>;
  is_active: boolean;
  members: AutoAssignMember[];
  created_at: string;
}

export function useAutoAssignRules() {
  const [rules, setRules] = useState<AutoAssignRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    try {
      const { data } = await api.get('/auto-assign/rules');
      setRules(data.rules || []);
    } catch {
      console.error('Failed to fetch auto-assign rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const createRule = useCallback(async (payload: {
    channel_id?: number | null;
    strategy: string;
    config?: Record<string, unknown>;
    member_ids?: string[];
  }) => {
    const { data } = await api.post('/auto-assign/rules', payload);
    await fetchRules();
    return data.rule;
  }, [fetchRules]);

  const updateRule = useCallback(async (ruleId: string, payload: Record<string, unknown>) => {
    await api.put(`/auto-assign/rules/${ruleId}`, payload);
    await fetchRules();
  }, [fetchRules]);

  const deleteRule = useCallback(async (ruleId: string) => {
    await api.delete(`/auto-assign/rules/${ruleId}`);
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  }, []);

  return { rules, loading, refetch: fetchRules, createRule, updateRule, deleteRule };
}
```

- [ ] **Step 2: Create the settings component**

Build `AutoAssignSettings.tsx` with:
- A card per channel showing its auto-assign rule (or "No rule" with "Add Rule" button)
- Strategy picker: dropdown with Round Robin, Least Busy, Tag-Based options
- Member pool: checkboxes from team members list, each with an availability toggle
- Tag-based config: when strategy is `tag_based`, show a table of tag → member mappings with add/remove
- Active/inactive toggle per rule
- Delete rule button

This component receives `channels` (from the parent settings page) and `teamMembers` as props, or fetches them internally.

- [ ] **Step 3: Add to SettingsPage**

Look at `client/src/pages/SettingsPage.tsx` — add an "Auto-Assign" tab or section. Import and render `<AutoAssignSettings />`.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useAutoAssignRules.ts client/src/components/settings/AutoAssignSettings.tsx client/src/pages/SettingsPage.tsx
git commit -m "feat: add auto-assign settings UI"
```

---

## Task 6: Availability Toggle in Sidebar

**Files:**
- Modify: `client/src/components/layout/AppLayout.tsx` or the sidebar component

- [ ] **Step 1: Add availability toggle**

At the bottom of the sidebar (near user avatar/profile section), add a toggle:

```tsx
<div className="flex items-center gap-2 px-3 py-2">
  <Switch
    checked={isAvailable}
    onCheckedChange={handleToggleAvailability}
    className="data-[state=checked]:bg-green-500"
  />
  <span className="text-xs text-muted-foreground">
    {isAvailable ? 'Available' : 'Away'}
  </span>
</div>
```

The `isAvailable` state comes from `GET /api/auto-assign/my-availability` on mount.
The `handleToggleAvailability` calls `PATCH /api/auto-assign/my-availability`.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/layout/
git commit -m "feat: add availability toggle to sidebar"
```

---

## Task 7: Build & Verify

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: No TypeScript errors, successful build.

- [ ] **Step 2: Manual testing checklist**

- Create a round-robin rule for a channel with 2 members
- Simulate 3 new incoming conversations → verify they alternate between members
- Set one member to "Away" → verify they stop receiving assignments
- Create a tag-based rule with a VIP tag → verify VIP contacts get routed correctly
- Create a least-busy rule → verify assignment goes to member with fewest open conversations
- Delete a rule → verify no more auto-assignment on that channel
