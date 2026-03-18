# Groups Page UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Groups page into a 3-tab layout (Groups, Alert Rules, Matched Messages) with auto-sync from Whapi, replacing the current drill-in GroupDetail pattern.

**Architecture:** Server adds sync endpoint + cross-group matches endpoint. Client replaces 2-tab + drill-in layout with a flat 3-tab page. "Global vs group-specific" criteria becomes a "scope" field on each alert rule. Groups auto-populate from Whapi on first visit.

**Tech Stack:** Express + Supabase (server), React + shadcn/ui + Tailwind (client), Whapi Gate API (group sync)

**Spec:** `docs/superpowers/specs/2026-03-18-groups-ux-redesign.md`

---

## File Structure

### Server — New/Modified
| File | Responsibility |
|------|---------------|
| `supabase/migrations/066_rule_group_id.sql` | Add `rule_group_id` column to `group_criteria` |
| `server/src/services/whapi.ts` | Add `listGroups(channelToken)` function |
| `server/src/routes/groups.ts` | Add `POST /sync`, `GET /all-criteria`, `GET /all-matches` endpoints |

### Client — New
| File | Responsibility |
|------|---------------|
| `client/src/components/groups/AlertRulesList.tsx` | Unified alert rules table with toggle/edit/delete |
| `client/src/components/groups/AlertRuleDialog.tsx` | Create/edit rule dialog with scope selector |
| `client/src/components/groups/MatchedMessagesList.tsx` | Cross-group matched messages view with filters |
| `client/src/hooks/useAlertRules.ts` | Fetch all criteria, CRUD with multi-scope support |
| `client/src/hooks/useMatchedMessages.ts` | Fetch cross-group matches, paginated |

### Client — Modified
| File | Responsibility |
|------|---------------|
| `client/src/types/groups.ts` | Add `rule_group_id` to `GroupCriteria`, update `GroupCriteriaMatch` |
| `client/src/hooks/useGroups.ts` | Add `syncGroups()` function |
| `client/src/hooks/useGroupRealtime.ts` | Add cross-group match support (remove group filter) |
| `client/src/pages/GroupsPage.tsx` | Rewrite to 3-tab layout |
| `client/src/components/groups/GroupsList.tsx` | Simplify to Card-based toggle list (no click-to-navigate) |

### Client — Delete
| File | Reason |
|------|--------|
| `client/src/components/groups/GroupDetail.tsx` | Replaced by Alert Rules + Matched Messages tabs |
| `client/src/components/groups/GlobalCriteriaList.tsx` | Replaced by AlertRulesList |
| `client/src/components/groups/CriteriaCard.tsx` | Replaced by AlertRulesList inline rendering |
| `client/src/components/groups/CriteriaDialog.tsx` | Replaced by AlertRuleDialog |
| `client/src/hooks/useGroupCriteria.ts` | Replaced by useAlertRules |
| `client/src/hooks/useGroupMessages.ts` | Replaced by useMatchedMessages |

### Client — Keep (no changes)
| File | Reason |
|------|--------|
| `client/src/components/groups/TeamMemberMultiSelect.tsx` | Reused by AlertRuleDialog |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/066_rule_group_id.sql`

- [ ] **Step 1: Write migration**

```sql
-- Add rule_group_id for linking multi-scope alert rules
ALTER TABLE group_criteria ADD COLUMN rule_group_id UUID DEFAULT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/066_rule_group_id.sql
git commit -m "feat: add rule_group_id column for multi-scope alert rules"
```

**Note:** Do NOT execute this migration yet. It will be run after all code changes are complete.

---

## Task 2: Server — Whapi `listGroups` Function

**Files:**
- Modify: `server/src/services/whapi.ts`

- [ ] **Step 1: Add `listGroups` function after `getGroupInfo`**

```typescript
export async function listGroups(
  channelToken: string
): Promise<Array<{ id: string; name: string; participants_count?: number }>> {
  const gate = gateApi(channelToken);
  const allGroups: Array<{ id: string; name: string; participants_count?: number }> = [];

  try {
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const { data } = await gate.get('/groups', {
        params: { count: limit, offset },
      });

      const groups = data.groups || data || [];
      if (!Array.isArray(groups) || groups.length === 0) {
        hasMore = false;
        break;
      }

      for (const g of groups) {
        allGroups.push({
          id: g.id,
          name: g.name || '',
          participants_count: g.participants?.length ?? undefined,
        });
      }

      offset += groups.length;
      hasMore = groups.length === limit;
    }
  } catch (err) {
    console.error('[whapi] Failed to list groups:', err);
  }

  return allGroups;
}
```

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
npx tsc --noEmit --project server/tsconfig.json 2>&1 | grep -E "whapi\.ts"
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/whapi.ts
git commit -m "feat: add listGroups function to Whapi service"
```

---

## Task 3: Server — Sync, All-Criteria, and All-Matches Endpoints

**Files:**
- Modify: `server/src/routes/groups.ts`

- [ ] **Step 1: Add `POST /sync` endpoint**

Add this BEFORE the parameterized `/:id` routes section, after the existing static routes:

```typescript
// POST /groups/sync — Sync groups from Whapi for all connected channels
router.post('/sync', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Get all connected channels for this company
    const { data: channels, error: chErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_token')
      .eq('company_id', companyId)
      .eq('channel_status', 'connected');

    if (chErr) throw chErr;
    if (!channels || channels.length === 0) {
      return res.json({ groups: [], new_count: 0, errors: [] });
    }

    const allGroups: any[] = [];
    const errors: Array<{ channel_id: number; error: string }> = [];

    // Fetch groups from each channel in parallel
    const results = await Promise.allSettled(
      channels.map(async (ch) => {
        const groups = await listGroups(ch.channel_token);
        return { channel: ch, groups };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { channel, groups } = result.value;
        for (const g of groups) {
          allGroups.push({
            company_id: companyId,
            channel_id: channel.id,
            group_jid: g.id,
            group_name: g.name || null,
          });
        }
      } else {
        // Extract channel_id from the error context
        errors.push({
          channel_id: 0,
          error: result.reason?.message || 'Unknown error',
        });
      }
    }

    // Upsert all discovered groups (don't touch monitoring_enabled for existing groups)
    let newCount = 0;
    if (allGroups.length > 0) {
      const { data: existing } = await supabaseAdmin
        .from('group_chats')
        .select('group_jid, channel_id')
        .eq('company_id', companyId);

      const existingSet = new Set(
        (existing || []).map((e: any) => `${e.channel_id}:${e.group_jid}`)
      );

      const newGroups = allGroups.filter(
        (g) => !existingSet.has(`${g.channel_id}:${g.group_jid}`)
      );

      if (newGroups.length > 0) {
        const { error: insertErr } = await supabaseAdmin
          .from('group_chats')
          .insert(newGroups);
        if (insertErr) throw insertErr;
        newCount = newGroups.length;
      }

      // Update names for existing groups that have a name from Whapi
      const namesToUpdate = allGroups.filter(
        (g) => g.group_name && existingSet.has(`${g.channel_id}:${g.group_jid}`)
      );
      for (const g of namesToUpdate) {
        await supabaseAdmin
          .from('group_chats')
          .update({ group_name: g.group_name, updated_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('channel_id', g.channel_id)
          .eq('group_jid', g.group_jid)
          .is('group_name', null); // Only update if name was missing
      }
    }

    // Re-fetch all groups to return the full list
    const { data: groups, error: fetchErr } = await supabaseAdmin
      .from('group_chats')
      .select('*, whatsapp_channels(channel_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (fetchErr) throw fetchErr;

    const enriched = (groups || []).map((g: any) => ({
      ...g,
      channel_name: g.whatsapp_channels?.channel_name ?? null,
      whatsapp_channels: undefined,
    }));

    res.json({ groups: enriched, new_count: newCount, errors });
  } catch (err) {
    next(err);
  }
});
```

Also add the `listGroups` import at the top of the file:
```typescript
import { getGroupInfo, listGroups } from '../services/whapi.js';
```

- [ ] **Step 2: Add `GET /all-criteria` endpoint**

Add after the `/sync` route:

```typescript
// GET /groups/all-criteria — List ALL criteria for the company (global + group-specific)
router.get('/all-criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Add `GET /all-matches` endpoint**

Add after `/all-criteria`:

```typescript
// GET /groups/all-matches — Cross-group matched messages
router.get('/all-matches', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { limit = '50', offset = '0', group_id, criteria_id } = req.query;

    let query = supabaseAdmin
      .from('group_criteria_matches')
      .select('*, group_chat_messages (*)', { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    // If filtering by group, get message IDs for that group first
    if (group_id && typeof group_id === 'string') {
      const { data: msgIds } = await supabaseAdmin
        .from('group_chat_messages')
        .select('id')
        .eq('group_chat_id', group_id)
        .eq('company_id', companyId);

      const ids = (msgIds || []).map((m: any) => m.id);
      if (ids.length === 0) {
        return res.json({ matches: [], count: 0 });
      }
      query = query.in('group_chat_message_id', ids);
    }

    const { data: matches, error, count } = await query;
    if (error) throw error;

    // If filtering by criteria_id, post-filter (criteria_ids is a UUID[] column)
    let result = matches || [];
    if (criteria_id && typeof criteria_id === 'string') {
      result = result.filter((m: any) =>
        m.criteria_ids && m.criteria_ids.includes(criteria_id)
      );
    }

    res.json({ matches: result, count });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Update `POST /groups/criteria` to accept `rule_group_id`**

Find the existing `POST /criteria` handler and add `rule_group_id` to the destructured body and the insert payload:

```typescript
// In the existing POST /criteria handler, add rule_group_id to destructuring:
const {
  group_chat_id,
  rule_group_id,  // ADD THIS
  name,
  match_type,
  keyword_config,
  ai_description,
  notify_user_ids,
  is_enabled,
} = req.body;

// And add to the insert:
const { data, error } = await supabaseAdmin
  .from('group_criteria')
  .insert({
    company_id: companyId,
    group_chat_id: group_chat_id || null,
    rule_group_id: rule_group_id || null,  // ADD THIS
    name,
    match_type,
    keyword_config: keyword_config || {},
    ai_description: ai_description || null,
    notify_user_ids: notify_user_ids || [],
    is_enabled: is_enabled ?? true,
  })
  .select()
  .single();
```

- [ ] **Step 5: Build and verify**

```bash
npx tsc --noEmit --project server/tsconfig.json 2>&1 | grep -E "groups\.ts"
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/groups.ts
git commit -m "feat: add sync, all-criteria, all-matches endpoints; accept rule_group_id in criteria create"
```

---

## Task 4: Client Types

**Files:**
- Modify: `client/src/types/groups.ts`

- [ ] **Step 1: Update types**

Replace the entire file:

```typescript
export interface GroupChat {
  id: string;
  company_id: string;
  channel_id: number;
  group_jid: string;
  group_name: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields from API
  channel_name?: string;
  criteria_count?: number;
}

export interface GroupChatMessage {
  id: string;
  group_chat_id: string;
  whatsapp_message_id: string;
  sender_phone: string | null;
  sender_name: string | null;
  message_body: string | null;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface GroupCriteria {
  id: string;
  company_id?: string;
  group_chat_id: string | null;
  rule_group_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** A rule as displayed in the UI — may represent multiple DB rows if multi-scope */
export interface AlertRule {
  /** ID of the first criteria row (used as the key) */
  id: string;
  rule_group_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  /** null = "All Groups", array of IDs = specific groups */
  scope: string[] | null;
  /** Display names for scoped groups */
  scope_names?: string[];
  created_at: string;
}

export interface GroupCriteriaMatch {
  id: string;
  company_id?: string;
  group_chat_message_id: string;
  criteria_ids: string[];
  notification_ids?: string[];
  created_at: string;
  // Joined fields
  group_chat_messages?: GroupChatMessage;
}

export interface SyncResult {
  groups: GroupChat[];
  new_count: number;
  errors: Array<{ channel_id: number; error: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types/groups.ts
git commit -m "feat: update group types for redesigned alert rules and sync"
```

---

## Task 5: Client Hooks

**Files:**
- Modify: `client/src/hooks/useGroups.ts`
- Create: `client/src/hooks/useAlertRules.ts`
- Create: `client/src/hooks/useMatchedMessages.ts`
- Modify: `client/src/hooks/useGroupRealtime.ts`

- [ ] **Step 1: Update `useGroups.ts` — add `syncGroups`**

Replace the entire file:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { GroupChat } from '@/types/groups';

export function useGroups() {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const hasAutoSynced = useRef(false);

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await api.get('/groups');
      setGroups(data.groups || []);
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const syncGroups = useCallback(async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/groups/sync');
      setGroups(data.groups || []);
      if (data.new_count > 0) {
        toast.success(`Synced — ${data.new_count} new group${data.new_count > 1 ? 's' : ''} found`);
      } else {
        toast.success('All groups up to date');
      }
      if (data.errors?.length > 0) {
        toast.error(`${data.errors.length} channel${data.errors.length > 1 ? 's' : ''} failed to sync`);
      }
    } catch (err) {
      console.error('Failed to sync groups:', err);
      toast.error('Failed to sync groups');
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-sync on first visit if no groups exist
  useEffect(() => {
    if (!loading && groups.length === 0 && !hasAutoSynced.current) {
      hasAutoSynced.current = true;
      syncGroups();
    }
  }, [loading, groups.length, syncGroups]);

  const toggleMonitoring = useCallback(async (groupId: string, enabled: boolean) => {
    await api.patch(`/groups/${groupId}`, { monitoring_enabled: enabled });
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, monitoring_enabled: enabled } : g))
    );
  }, []);

  return { groups, loading, syncing, refetch: fetchGroups, syncGroups, toggleMonitoring };
}
```

- [ ] **Step 2: Create `useAlertRules.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { GroupCriteria, AlertRule, GroupChat } from '@/types/groups';

/** Merge raw criteria rows into AlertRule display objects */
function buildAlertRules(criteria: GroupCriteria[], groups: GroupChat[]): AlertRule[] {
  const groupMap = new Map(groups.map((g) => [g.id, g.group_name || g.group_jid]));
  const ruleMap = new Map<string, AlertRule>();

  for (const c of criteria) {
    // Group by rule_group_id if present, otherwise treat as individual
    const key = c.rule_group_id || c.id;

    if (ruleMap.has(key)) {
      // Append this group to existing rule's scope
      const existing = ruleMap.get(key)!;
      if (c.group_chat_id && existing.scope) {
        existing.scope.push(c.group_chat_id);
        existing.scope_names = existing.scope.map((id) => groupMap.get(id) || id);
      }
    } else {
      ruleMap.set(key, {
        id: c.id,
        rule_group_id: c.rule_group_id,
        name: c.name,
        match_type: c.match_type,
        keyword_config: c.keyword_config,
        ai_description: c.ai_description,
        notify_user_ids: c.notify_user_ids,
        is_enabled: c.is_enabled,
        scope: c.group_chat_id ? [c.group_chat_id] : null,
        scope_names: c.group_chat_id
          ? [groupMap.get(c.group_chat_id) || c.group_chat_id]
          : undefined,
        created_at: c.created_at,
      });
    }
  }

  return Array.from(ruleMap.values());
}

export function useAlertRules(groups: GroupChat[]) {
  const [rawCriteria, setRawCriteria] = useState<GroupCriteria[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCriteria = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/groups/all-criteria');
      setRawCriteria(data.criteria || []);
    } catch (err) {
      console.error('Failed to fetch alert rules:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  const rules = buildAlertRules(rawCriteria, groups);

  const createRule = useCallback(
    async (values: {
      name: string;
      match_type: 'keyword' | 'ai';
      keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
      ai_description?: string;
      notify_user_ids: string[];
      scope: string[] | null; // null = all groups
    }) => {
      const groupIds = values.scope || [null]; // null = global
      const ruleGroupId = groupIds.length > 1 ? crypto.randomUUID() : null;

      const rows = groupIds.map((gid) => ({
        group_chat_id: gid,
        rule_group_id: ruleGroupId,
        name: values.name,
        match_type: values.match_type,
        keyword_config: values.keyword_config || {},
        ai_description: values.ai_description || null,
        notify_user_ids: values.notify_user_ids,
        is_enabled: true,
      }));

      // Create all rows
      for (const row of rows) {
        await api.post('/groups/criteria', row);
      }

      await fetchCriteria();
      toast.success('Alert rule created');
    },
    [fetchCriteria]
  );

  const updateRule = useCallback(
    async (
      rule: AlertRule,
      values: {
        name?: string;
        match_type?: 'keyword' | 'ai';
        keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
        ai_description?: string;
        notify_user_ids?: string[];
        is_enabled?: boolean;
        scope?: string[] | null;
      }
    ) => {
      // If scope changed, need to add/remove rows
      if (values.scope !== undefined) {
        // Delete all existing rows for this rule
        const existingRows = rawCriteria.filter(
          (c) =>
            c.id === rule.id ||
            (rule.rule_group_id && c.rule_group_id === rule.rule_group_id)
        );
        for (const row of existingRows) {
          await api.delete(`/groups/criteria/${row.id}`);
        }

        // Re-create with new scope
        await createRule({
          name: values.name || rule.name,
          match_type: values.match_type || rule.match_type,
          keyword_config: values.keyword_config || rule.keyword_config,
          ai_description: values.ai_description ?? rule.ai_description,
          notify_user_ids: values.notify_user_ids || rule.notify_user_ids,
          scope: values.scope,
        });
        return;
      }

      // Simple update — update all rows for this rule
      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      const updatePayload: Record<string, unknown> = {};
      if (values.name !== undefined) updatePayload.name = values.name;
      if (values.match_type !== undefined) updatePayload.match_type = values.match_type;
      if (values.keyword_config !== undefined) updatePayload.keyword_config = values.keyword_config;
      if (values.ai_description !== undefined) updatePayload.ai_description = values.ai_description;
      if (values.notify_user_ids !== undefined) updatePayload.notify_user_ids = values.notify_user_ids;
      if (values.is_enabled !== undefined) updatePayload.is_enabled = values.is_enabled;

      for (const id of rowIds) {
        await api.patch(`/groups/criteria/${id}`, updatePayload);
      }

      await fetchCriteria();
    },
    [rawCriteria, fetchCriteria, createRule]
  );

  const deleteRule = useCallback(
    async (rule: AlertRule) => {
      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      for (const id of rowIds) {
        await api.delete(`/groups/criteria/${id}`);
      }

      await fetchCriteria();
      toast.success('Alert rule deleted');
    },
    [rawCriteria, fetchCriteria]
  );

  const toggleRule = useCallback(
    async (rule: AlertRule, enabled: boolean) => {
      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      for (const id of rowIds) {
        await api.patch(`/groups/criteria/${id}`, { is_enabled: enabled });
      }

      setRawCriteria((prev) =>
        prev.map((c) =>
          rowIds.includes(c.id) ? { ...c, is_enabled: enabled } : c
        )
      );
    },
    [rawCriteria]
  );

  return { rules, rawCriteria, loading, refetch: fetchCriteria, createRule, updateRule, deleteRule, toggleRule };
}
```

- [ ] **Step 3: Create `useMatchedMessages.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupCriteriaMatch } from '@/types/groups';

export function useMatchedMessages() {
  const [matches, setMatches] = useState<GroupCriteriaMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [filterCriteriaId, setFilterCriteriaId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterGroupId) params.set('group_id', filterGroupId);
      if (filterCriteriaId) params.set('criteria_id', filterCriteriaId);
      const { data } = await api.get(`/groups/all-matches?${params}`);
      setMatches(data.matches || []);
    } catch (err) {
      console.error('Failed to fetch matched messages:', err);
    } finally {
      setLoading(false);
    }
  }, [filterGroupId, filterCriteriaId]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  return {
    matches,
    loading,
    filterGroupId,
    filterCriteriaId,
    setFilterGroupId,
    setFilterCriteriaId,
    setMatches,
    refetch: fetchMatches,
  };
}
```

- [ ] **Step 4: Update `useGroupRealtime.ts`**

Add `setMatches` support for cross-group realtime. The hook itself stays the same — it already listens to all `group_criteria_matches` INSERTs for the company. The change is that callers no longer need to filter by `group_chat_id`. No code changes needed to the hook — the callers (GroupsPage) will wire the callbacks differently.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useGroups.ts client/src/hooks/useAlertRules.ts client/src/hooks/useMatchedMessages.ts
git commit -m "feat: add useAlertRules and useMatchedMessages hooks, update useGroups with sync"
```

---

## Task 6: Client — GroupsList Component (Simplified)

**Files:**
- Modify: `client/src/components/groups/GroupsList.tsx`

- [ ] **Step 1: Rewrite GroupsList as Card-based list with no click-to-navigate**

```tsx
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { GroupChat } from '@/types/groups';

interface GroupsListProps {
  groups: GroupChat[];
  loading: boolean;
  toggleMonitoring: (groupId: string, enabled: boolean) => void;
}

export function GroupsList({ groups, loading, toggleMonitoring }: GroupsListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No groups found</p>
          <p className="text-xs text-muted-foreground">
            Click "Sync Groups" to discover groups from your WhatsApp channels.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <Card key={group.id} className="transition-colors">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {group.group_name || group.group_jid}
                  </span>
                  {(group.criteria_count ?? 0) > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      {group.criteria_count} rule{group.criteria_count !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {group.channel_name ? `${group.channel_name} · ` : ''}
                  {group.group_jid}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4 shrink-0">
              <span className="text-xs text-muted-foreground">
                {group.monitoring_enabled ? 'Monitoring' : 'Off'}
              </span>
              <Switch
                checked={group.monitoring_enabled}
                onCheckedChange={(enabled) => toggleMonitoring(group.id, enabled)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/GroupsList.tsx
git commit -m "feat: redesign GroupsList as Card-based list with no drill-in"
```

---

## Task 7: Client — AlertRulesList Component

**Files:**
- Create: `client/src/components/groups/AlertRulesList.tsx`

- [ ] **Step 1: Create AlertRulesList**

```tsx
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Plus, Pencil, Trash2, Globe, Target, Loader2 } from 'lucide-react';
import { AlertRuleDialog } from './AlertRuleDialog';
import type { AlertRule, GroupChat } from '@/types/groups';

interface AlertRulesListProps {
  rules: AlertRule[];
  groups: GroupChat[];
  loading: boolean;
  onCreateRule: (values: any) => Promise<void>;
  onUpdateRule: (rule: AlertRule, values: any) => Promise<void>;
  onDeleteRule: (rule: AlertRule) => Promise<void>;
  onToggleRule: (rule: AlertRule, enabled: boolean) => Promise<void>;
}

export function AlertRulesList({
  rules,
  groups,
  loading,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onToggleRule,
}: AlertRulesListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-medium">Alert Rules</h3>
          <p className="text-sm text-muted-foreground">
            Get notified when group messages match your criteria
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Target className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No alert rules yet</p>
            <p className="text-xs text-muted-foreground">
              Add a rule to get notified when group messages match your criteria.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card key={rule.id} className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center justify-between py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{rule.name}</span>
                    <Badge variant="secondary">
                      {rule.match_type === 'keyword' ? 'Keyword' : 'AI'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      {rule.scope === null ? (
                        <>
                          <Globe className="h-3 w-3" />
                          All Groups
                        </>
                      ) : (
                        <>
                          <Target className="h-3 w-3" />
                          {rule.scope_names?.join(', ') || `${rule.scope.length} group${rule.scope.length > 1 ? 's' : ''}`}
                        </>
                      )}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {rule.match_type === 'keyword'
                      ? `Keywords: ${rule.keyword_config.keywords?.join(', ') || 'none'} (${rule.keyword_config.operator?.toUpperCase()})`
                      : rule.ai_description || 'No description'}
                    {rule.notify_user_ids.length > 0 &&
                      ` · Notifies ${rule.notify_user_ids.length} member${rule.notify_user_ids.length > 1 ? 's' : ''}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <Switch
                    checked={rule.is_enabled}
                    onCheckedChange={(enabled) => onToggleRule(rule, enabled)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(rule);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        groups={groups}
        onSave={async (values) => {
          if (editing) {
            await onUpdateRule(editing, values);
          } else {
            await onCreateRule(values);
          }
          setDialogOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete Alert Rule"
        description={`Are you sure you want to delete "${deleting?.name}"? This cannot be undone.`}
        actionLabel="Delete"
        onConfirm={async () => {
          if (deleting) {
            await onDeleteRule(deleting);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/AlertRulesList.tsx
git commit -m "feat: add AlertRulesList component for unified rule management"
```

---

## Task 8: Client — AlertRuleDialog Component

**Files:**
- Create: `client/src/components/groups/AlertRuleDialog.tsx`

- [ ] **Step 1: Create AlertRuleDialog**

```tsx
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, X } from 'lucide-react';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import type { AlertRule, GroupChat } from '@/types/groups';

interface AlertRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: AlertRule | null;
  groups: GroupChat[];
  onSave: (values: {
    name: string;
    match_type: 'keyword' | 'ai';
    keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
    ai_description?: string;
    notify_user_ids: string[];
    scope: string[] | null;
  }) => Promise<void>;
}

export function AlertRuleDialog({
  open,
  onOpenChange,
  rule,
  groups,
  onSave,
}: AlertRuleDialogProps) {
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'keyword' | 'ai'>('keyword');
  const [keywords, setKeywords] = useState('');
  const [operator, setOperator] = useState<'and' | 'or'>('or');
  const [aiDescription, setAiDescription] = useState('');
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
  const [scopeType, setScopeType] = useState<'all' | 'specific'>('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens/closes or rule changes
  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setMatchType(rule.match_type);
        setKeywords(rule.keyword_config?.keywords?.join(', ') || '');
        setOperator(rule.keyword_config?.operator || 'or');
        setAiDescription(rule.ai_description || '');
        setNotifyUserIds(rule.notify_user_ids || []);
        setScopeType(rule.scope === null ? 'all' : 'specific');
        setSelectedGroupIds(rule.scope || []);
      } else {
        setName('');
        setMatchType('keyword');
        setKeywords('');
        setOperator('or');
        setAiDescription('');
        setNotifyUserIds([]);
        setScopeType('all');
        setSelectedGroupIds([]);
      }
    }
  }, [open, rule]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        match_type: matchType,
        keyword_config:
          matchType === 'keyword'
            ? {
                keywords: keywords
                  .split(',')
                  .map((k) => k.trim())
                  .filter(Boolean),
                operator,
              }
            : undefined,
        ai_description: matchType === 'ai' ? aiDescription : undefined,
        notify_user_ids: notifyUserIds,
        scope: scopeType === 'all' ? null : selectedGroupIds,
      });
    } finally {
      setSaving(false);
    }
  };

  const monitoredGroups = groups.filter((g) => g.monitoring_enabled);
  const canSave = name.trim() && (matchType === 'ai' ? aiDescription.trim() : keywords.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit Alert Rule' : 'New Alert Rule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label>Rule Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Competitor mentions"
            />
          </div>

          {/* Match Type */}
          <div className="space-y-2">
            <Label>Match Type</Label>
            <Select
              value={matchType}
              onValueChange={(v) => setMatchType(v as 'keyword' | 'ai')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword Match</SelectItem>
                <SelectItem value="ai">AI Match</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Keyword Config */}
          {matchType === 'keyword' && (
            <>
              <div className="space-y-2">
                <Label>Keywords (comma-separated)</Label>
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g., pricing, discount, competitor"
                />
              </div>
              <div className="space-y-2">
                <Label>Operator</Label>
                <Select
                  value={operator}
                  onValueChange={(v) => setOperator(v as 'and' | 'or')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="or">
                      ANY keyword (OR)
                    </SelectItem>
                    <SelectItem value="and">
                      ALL keywords (AND)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* AI Config */}
          {matchType === 'ai' && (
            <div className="space-y-2">
              <Label>Description (what should this rule detect?)</Label>
              <Textarea
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="e.g., Someone asking about pricing or requesting a discount"
                rows={3}
              />
            </div>
          )}

          {/* Scope */}
          <div className="space-y-2">
            <Label>Apply to</Label>
            <Select
              value={scopeType}
              onValueChange={(v) => setScopeType(v as 'all' | 'specific')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All monitored groups</SelectItem>
                <SelectItem value="specific">Specific groups</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scopeType === 'specific' && (
            <div className="space-y-2">
              <Label>Select groups</Label>
              <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
                {monitoredGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    No monitored groups. Enable monitoring on a group first.
                  </p>
                ) : (
                  monitoredGroups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedGroupIds.includes(g.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGroupIds((prev) => [...prev, g.id]);
                          } else {
                            setSelectedGroupIds((prev) =>
                              prev.filter((id) => id !== g.id)
                            );
                          }
                        }}
                      />
                      <span className="text-sm">
                        {g.group_name || g.group_jid}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selectedGroupIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedGroupIds.map((id) => {
                    const g = groups.find((gr) => gr.id === id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {g?.group_name || g?.group_jid || id}
                        <button
                          onClick={() =>
                            setSelectedGroupIds((prev) =>
                              prev.filter((gid) => gid !== id)
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Notify */}
          <div className="space-y-2">
            <Label>Notify team members</Label>
            <TeamMemberMultiSelect
              value={notifyUserIds}
              onChange={setNotifyUserIds}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {rule ? 'Save Changes' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/AlertRuleDialog.tsx
git commit -m "feat: add AlertRuleDialog with scope selector for unified rule management"
```

---

## Task 9: Client — MatchedMessagesList Component

**Files:**
- Create: `client/src/components/groups/MatchedMessagesList.tsx`

- [ ] **Step 1: Create MatchedMessagesList**

```tsx
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MessageSquare } from 'lucide-react';
import type { GroupChat, GroupCriteriaMatch, GroupCriteria } from '@/types/groups';

interface MatchedMessagesListProps {
  matches: GroupCriteriaMatch[];
  groups: GroupChat[];
  criteria: GroupCriteria[];
  loading: boolean;
  filterGroupId: string | null;
  filterCriteriaId: string | null;
  onFilterGroupChange: (id: string | null) => void;
  onFilterCriteriaChange: (id: string | null) => void;
}

export function MatchedMessagesList({
  matches,
  groups,
  criteria,
  loading,
  filterGroupId,
  filterCriteriaId,
  onFilterGroupChange,
  onFilterCriteriaChange,
}: MatchedMessagesListProps) {
  const groupMap = new Map(groups.map((g) => [g.id, g.group_name || g.group_jid]));
  const criteriaMap = new Map(criteria.map((c) => [c.id, c.name]));

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={filterGroupId || '_all'}
          onValueChange={(v) => onFilterGroupChange(v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Groups</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.group_name || g.group_jid}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterCriteriaId || '_all'}
          onValueChange={(v) => onFilterCriteriaChange(v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Rules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Rules</SelectItem>
            {/* Deduplicate criteria by name */}
            {Array.from(new Map(criteria.map((c) => [c.name, c])).values()).map(
              (c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4 space-y-2">
                <Skeleton className="h-4 w-60" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No matched messages yet</p>
            <p className="text-xs text-muted-foreground">
              Matched messages will appear here when group messages trigger your alert rules.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {matches.map((match) => {
            const msg = match.group_chat_messages;
            if (!msg) return null;

            const groupName = groupMap.get(msg.group_chat_id) || msg.group_chat_id;
            const matchedRuleNames = (match.criteria_ids || [])
              .map((id) => criteriaMap.get(id))
              .filter(Boolean);

            return (
              <Card
                key={match.id}
                className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
              >
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {groupName}
                    </Badge>
                    <span className="font-medium text-sm">
                      {msg.sender_name || msg.sender_phone || 'Unknown'}
                    </span>
                    {msg.sender_phone && msg.sender_name && (
                      <span className="text-xs text-muted-foreground">
                        {msg.sender_phone}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(match.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm mb-2">{msg.message_body}</p>
                  {matchedRuleNames.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {matchedRuleNames.map((name, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/MatchedMessagesList.tsx
git commit -m "feat: add MatchedMessagesList for cross-group matched messages view"
```

---

## Task 10: Client — GroupsPage Rewrite

**Files:**
- Modify: `client/src/pages/GroupsPage.tsx`

- [ ] **Step 1: Rewrite GroupsPage with 3-tab layout**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { useGroups } from '@/hooks/useGroups';
import { useAlertRules } from '@/hooks/useAlertRules';
import { useMatchedMessages } from '@/hooks/useMatchedMessages';
import { useGroupRealtime } from '@/hooks/useGroupRealtime';
import { GroupsList } from '@/components/groups/GroupsList';
import { AlertRulesList } from '@/components/groups/AlertRulesList';
import { MatchedMessagesList } from '@/components/groups/MatchedMessagesList';

export default function GroupsPage() {
  const { groups, loading: groupsLoading, syncing, syncGroups, toggleMonitoring } =
    useGroups();
  const {
    rules,
    rawCriteria,
    loading: rulesLoading,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    refetch: refetchRules,
  } = useAlertRules(groups);
  const {
    matches,
    loading: matchesLoading,
    filterGroupId,
    filterCriteriaId,
    setFilterGroupId,
    setFilterCriteriaId,
    refetch: refetchMatches,
  } = useMatchedMessages();

  // Realtime updates for new matches
  // Note: raw realtime payloads don't include joined group_chat_messages,
  // so we refetch the full matches list instead of prepending the raw payload.
  useGroupRealtime({
    onNewMatch: () => {
      refetchMatches();
      refetchRules();
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Groups</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor WhatsApp group chats and get alerted on matching messages
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={syncGroups}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Groups
          </Button>
        </div>
      </div>

      <Tabs defaultValue="groups" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="groups">
              Groups{!groupsLoading && groups.length > 0 ? ` (${groups.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="rules">
              Alert Rules{!rulesLoading && rules.length > 0 ? ` (${rules.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="matches">Matched Messages</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="groups" className="flex-1 p-6">
          <GroupsList
            groups={groups}
            loading={groupsLoading}
            toggleMonitoring={toggleMonitoring}
          />
        </TabsContent>

        <TabsContent value="rules" className="flex-1 p-6">
          <AlertRulesList
            rules={rules}
            groups={groups}
            loading={rulesLoading}
            onCreateRule={createRule}
            onUpdateRule={updateRule}
            onDeleteRule={deleteRule}
            onToggleRule={toggleRule}
          />
        </TabsContent>

        <TabsContent value="matches" className="flex-1 p-6">
          <MatchedMessagesList
            matches={matches}
            groups={groups}
            criteria={rawCriteria}
            loading={matchesLoading}
            filterGroupId={filterGroupId}
            filterCriteriaId={filterCriteriaId}
            onFilterGroupChange={setFilterGroupId}
            onFilterCriteriaChange={setFilterCriteriaId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/GroupsPage.tsx
git commit -m "feat: rewrite GroupsPage with 3-tab layout (groups, alert rules, matches)"
```

---

## Task 11: Cleanup — Delete Old Components

**Files:**
- Delete: `client/src/components/groups/GroupDetail.tsx`
- Delete: `client/src/components/groups/GlobalCriteriaList.tsx`
- Delete: `client/src/components/groups/CriteriaCard.tsx`
- Delete: `client/src/components/groups/CriteriaDialog.tsx`
- Delete: `client/src/hooks/useGroupCriteria.ts`
- Delete: `client/src/hooks/useGroupMessages.ts`

- [ ] **Step 1: Delete old files**

```bash
git rm client/src/components/groups/GroupDetail.tsx \
      client/src/components/groups/GlobalCriteriaList.tsx \
      client/src/components/groups/CriteriaCard.tsx \
      client/src/components/groups/CriteriaDialog.tsx \
      client/src/hooks/useGroupCriteria.ts \
      client/src/hooks/useGroupMessages.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "cleanup: remove old group detail, criteria card/dialog, and replaced hooks"
```

---

## Task 12: Build Verification

- [ ] **Step 1: Run TypeScript check (server)**

```bash
npx tsc --noEmit --project server/tsconfig.json
```

- [ ] **Step 2: Run TypeScript check (client)**

```bash
npx tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 3: Run full build**

```bash
npm run build
```

- [ ] **Step 4: Fix any errors found, then commit**

```bash
git add -A
git commit -m "fix: resolve build errors from groups page redesign"
```

---

## Task 13: Run Migration

**Note:** Only after all code changes are verified and committed.

- [ ] **Step 1: Execute migration**

```bash
source server/.env && pg_dump --schema-only --schema=public "$SUPABASE_DB_URL" | head -5
# Verify connection works, then:
source server/.env && psql "$SUPABASE_DB_URL" -f supabase/migrations/066_rule_group_id.sql
```

- [ ] **Step 2: Verify column exists**

```bash
source server/.env && psql "$SUPABASE_DB_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='group_criteria' AND column_name='rule_group_id'"
```

---

## Dependency Notes

- **No new dependencies needed.** `useAlertRules.ts` uses `crypto.randomUUID()` which is available in all modern browsers and Node.js 19+.
- **`ConfirmDialog` component**: Used in `AlertRulesList`. Verify it exists at `client/src/components/ui/confirm-dialog.tsx`. If not, use a simple `window.confirm` fallback or create a minimal one.
