# Group Chat Criteria Alerts — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable customers to monitor WhatsApp group chats and receive in-app notifications when messages match configurable keyword or AI-powered criteria.

**Architecture:** New database tables for groups, messages, criteria, and matches. Webhook modified to ingest group messages (read-only, never respond). New `groupCriteriaService` evaluates messages against criteria and creates notifications via existing notification system. New `/groups` frontend page with two tabs (Groups and Global Criteria).

**Tech Stack:** Express 5 + TypeScript (backend), React 19 + Radix/shadcn + Tailwind (frontend), Supabase (Postgres + RLS + Realtime), Anthropic Claude API (AI criteria evaluation)

**Spec:** `docs/superpowers/specs/2026-03-16-group-chat-criteria-alerts-design.md`

---

## Chunk 1: Database & Types

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/063_group_chat_criteria.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================
-- 063: Group Chat Criteria Alerts
-- Tables: group_chats, group_chat_messages, group_criteria, group_criteria_matches
-- =============================================================

-- 1. group_chats — discovered WhatsApp groups
CREATE TABLE IF NOT EXISTS group_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_name TEXT,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, group_jid)
);

ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_chats_company_isolation" ON group_chats
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- 2. group_chat_messages — messages from monitored groups
CREATE TABLE IF NOT EXISTS group_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT NOT NULL,
  sender_phone TEXT,
  sender_name TEXT,
  message_body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_chat_id, whatsapp_message_id)
);

ALTER TABLE group_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_chat_messages_company_isolation" ON group_chat_messages
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Index for fetching messages by group (paginated by time)
CREATE INDEX idx_group_chat_messages_group_time
  ON group_chat_messages (group_chat_id, created_at DESC);

-- 3. group_criteria — configurable alert rules
CREATE TABLE IF NOT EXISTS group_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_id UUID REFERENCES group_chats(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('keyword', 'ai')),
  keyword_config JSONB DEFAULT '{}',
  ai_description TEXT,
  notify_user_ids UUID[] NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE group_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_criteria_company_isolation" ON group_criteria
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Index for fetching criteria by group (including global where group_chat_id IS NULL)
CREATE INDEX idx_group_criteria_group ON group_criteria (group_chat_id);
CREATE INDEX idx_group_criteria_company ON group_criteria (company_id);

-- 4. group_criteria_matches — log of triggered criteria
CREATE TABLE IF NOT EXISTS group_criteria_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_chat_message_id UUID NOT NULL REFERENCES group_chat_messages(id) ON DELETE CASCADE,
  criteria_ids UUID[] NOT NULL DEFAULT '{}',
  notification_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE group_criteria_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_criteria_matches_company_isolation" ON group_criteria_matches
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX idx_group_criteria_matches_message
  ON group_criteria_matches (group_chat_message_id);

-- 5. Add new notification type to the check constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'share', 'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note', 'handoff',
    'group_criteria_match'
  ));

-- 6. Update notification_preferences column default to include new type
ALTER TABLE notification_preferences
  ALTER COLUMN preferences SET DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true,
    "handoff": true,
    "group_criteria_match": true
  }'::jsonb;

-- 7. Enable realtime for group tables
ALTER PUBLICATION supabase_realtime ADD TABLE group_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE group_criteria_matches;
```

- [ ] **Step 2: Verify migration file is syntactically valid**

Run: `grep -c "CREATE TABLE" supabase/migrations/063_group_chat_criteria.sql`
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/063_group_chat_criteria.sql
git commit -m "feat(groups): add database migration for group chat criteria alerts"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `server/src/types/index.ts` (append new interfaces at end of file)
- Create: `client/src/types/groups.ts`

- [ ] **Step 1: Add server-side types**

Append to `server/src/types/index.ts`:

```typescript
// ── Group Chat Criteria Alerts ──────────────────────────────

export interface GroupChat {
  id: string;
  company_id: string;
  channel_id: string;
  group_jid: string;
  group_name: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupChatMessage {
  id: string;
  company_id: string;
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
  company_id: string;
  group_chat_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupCriteriaMatch {
  id: string;
  company_id: string;
  group_chat_message_id: string;
  criteria_ids: string[];
  notification_ids: string[];
  created_at: string;
}
```

- [ ] **Step 2: Create client-side types**

Write `client/src/types/groups.ts`:

```typescript
export interface GroupChat {
  id: string;
  company_id: string;
  channel_id: string;
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
  group_chat_id: string | null;
  name: string;
  match_type: 'keyword' | 'ai';
  keyword_config: { keywords: string[]; operator: 'and' | 'or' };
  ai_description: string | null;
  notify_user_ids: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupCriteriaMatch {
  id: string;
  group_chat_message_id: string;
  criteria_ids: string[];
  notification_ids: string[];
  created_at: string;
  // Joined fields
  message?: GroupChatMessage;
  criteria?: GroupCriteria[];
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/types/index.ts client/src/types/groups.ts
git commit -m "feat(groups): add TypeScript types for group chat criteria"
```

---

## Chunk 2: Backend — Webhook & Group Ingestion

### Task 3: Group Message Ingestion in Webhook

**Files:**
- Modify: `server/src/routes/webhook.ts:89-97` (replace group skip logic)

- [ ] **Step 1: Replace the group message skip with ingestion logic**

In `server/src/routes/webhook.ts`, replace the block at lines 89-97:

```typescript
// BEFORE:
// if (msg.chat_id?.endsWith('@g.us')) continue;
```

Replace with:

```typescript
// Handle group messages separately (read-only — never respond)
if (msg.chat_id?.endsWith('@g.us')) {
  try {
    await processGroupMessage(msg, channel.company_id, channel.id);
  } catch (err) {
    console.error('[webhook] Error processing group message:', err);
  }
  continue;
}
```

- [ ] **Step 2: Add the import at the top of webhook.ts**

Add to imports section of `server/src/routes/webhook.ts`:

```typescript
import { processGroupMessage } from '../services/groupMessageProcessor.js';
```

- [ ] **Step 3: Create the group message processor service**

Create `server/src/services/groupMessageProcessor.ts`:

```typescript
import { supabaseAdmin } from '../config/supabase.js';
import { evaluateGroupCriteria } from './groupCriteriaService.js';
import type { GroupChat, GroupChatMessage } from '../types/index.js';

interface WhapiMessage {
  id: string;
  chat_id: string;
  from?: string;
  from_name?: string;
  text?: { body?: string };
  type?: string;
  [key: string]: unknown;
}

export async function processGroupMessage(
  msg: WhapiMessage,
  companyId: string,
  channelId: string
): Promise<void> {
  const groupJid = msg.chat_id;

  // 1. Look up or auto-create the group
  let { data: group } = await supabaseAdmin
    .from('group_chats')
    .select('*')
    .eq('channel_id', channelId)
    .eq('group_jid', groupJid)
    .single();

  if (!group) {
    // Auto-create with monitoring disabled
    const { data: newGroup, error } = await supabaseAdmin
      .from('group_chats')
      .insert({
        company_id: companyId,
        channel_id: channelId,
        group_jid: groupJid,
        group_name: null, // Will be updated when metadata is available
        monitoring_enabled: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[group] Failed to auto-create group:', error);
      return;
    }
    group = newGroup;
  }

  // 2. If monitoring is disabled, stop here
  if (!group.monitoring_enabled) return;

  // 3. Store the message
  const messageBody = msg.text?.body ?? null;
  const senderPhone = msg.from ?? null;
  const senderName = msg.from_name ?? null;
  const messageType = msg.type ?? 'text';

  const { data: storedMessage, error: msgError } = await supabaseAdmin
    .from('group_chat_messages')
    .upsert(
      {
        company_id: companyId,
        group_chat_id: group.id,
        whatsapp_message_id: msg.id,
        sender_phone: senderPhone,
        sender_name: senderName,
        message_body: messageBody,
        message_type: messageType,
        metadata: msg,
      },
      { onConflict: 'group_chat_id,whatsapp_message_id' }
    )
    .select()
    .single();

  if (msgError) {
    console.error('[group] Failed to store group message:', msgError);
    return;
  }

  // 4. Evaluate criteria (only for text messages with content)
  if (messageBody && messageType === 'text') {
    await evaluateGroupCriteria(storedMessage as GroupChatMessage, group as GroupChat);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/webhook.ts server/src/services/groupMessageProcessor.ts
git commit -m "feat(groups): ingest group messages from webhook instead of skipping"
```

---

### Task 4: Criteria Evaluation Service

**Files:**
- Create: `server/src/services/groupCriteriaService.ts`

- [ ] **Step 1: Create the criteria evaluation service**

Create `server/src/services/groupCriteriaService.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { createNotificationsForUsers } from './notificationService.js';
import type { GroupChat, GroupChatMessage, GroupCriteria } from '../types/index.js';

const anthropic = new Anthropic();

// ── Keyword Matching ────────────────────────────────────────

function evaluateKeywordCriteria(
  messageBody: string,
  criteria: GroupCriteria
): boolean {
  const config = criteria.keyword_config;
  if (!config?.keywords?.length) return false;

  const lowerBody = messageBody.toLowerCase();
  const keywords = config.keywords.map((k: string) => k.toLowerCase());

  if (config.operator === 'and') {
    return keywords.every((kw: string) => lowerBody.includes(kw));
  }
  // Default to 'or'
  return keywords.some((kw: string) => lowerBody.includes(kw));
}

// ── AI Matching ─────────────────────────────────────────────

async function evaluateAICriteria(
  messageBody: string,
  criteria: GroupCriteria[]
): Promise<string[]> {
  if (criteria.length === 0) return [];

  const MAX_PER_BATCH = 20;
  const matchedIds: string[] = [];

  for (let i = 0; i < criteria.length; i += MAX_PER_BATCH) {
    const batch = criteria.slice(i, i + MAX_PER_BATCH);
    try {
      const batchResults = await evaluateAIBatch(messageBody, batch);
      matchedIds.push(...batchResults);
    } catch (err) {
      console.error('[group-criteria] AI evaluation failed for batch, skipping:', err);
      // Non-blocking: keyword matches still produce notifications
    }
  }

  return matchedIds;
}

async function evaluateAIBatch(
  messageBody: string,
  criteria: GroupCriteria[]
): Promise<string[]> {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. [ID: ${c.id}] ${c.ai_description}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are evaluating a group chat message against a list of criteria. For each criteria, determine if the message matches.

Message:
"${messageBody}"

Criteria:
${criteriaList}

Respond with ONLY a JSON array of the IDs that matched. If none matched, respond with [].
Example: ["id1", "id2"]`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Extract JSON array from response
  const match = text.match(/\[.*\]/s);
  if (!match) return [];

  try {
    const ids = JSON.parse(match[0]) as string[];
    // Only return IDs that are actually in our criteria list
    const validIds = new Set(criteria.map((c) => c.id));
    return ids.filter((id) => validIds.has(id));
  } catch {
    console.error('[group-criteria] Failed to parse AI response:', text);
    return [];
  }
}

// ── Main Evaluation Pipeline ────────────────────────────────

export async function evaluateGroupCriteria(
  message: GroupChatMessage,
  group: GroupChat
): Promise<void> {
  // 1. Fetch all applicable criteria (group-specific + global)
  const { data: allCriteria, error } = await supabaseAdmin
    .from('group_criteria')
    .select('*')
    .eq('company_id', group.company_id)
    .eq('is_enabled', true)
    .or(`group_chat_id.eq.${group.id},group_chat_id.is.null`);

  if (error || !allCriteria?.length) return;

  const criteria = allCriteria as GroupCriteria[];
  const keywordCriteria = criteria.filter((c) => c.match_type === 'keyword');
  const aiCriteria = criteria.filter((c) => c.match_type === 'ai');

  // 2. Evaluate keyword criteria locally
  const matchedKeyword = keywordCriteria.filter((c) =>
    evaluateKeywordCriteria(message.message_body!, c)
  );

  // 3. Evaluate AI criteria via Claude
  const matchedAIIds = await evaluateAICriteria(message.message_body!, aiCriteria);
  const matchedAI = aiCriteria.filter((c) => matchedAIIds.includes(c.id));

  // 4. Consolidate matches
  const allMatched = [...matchedKeyword, ...matchedAI];
  if (allMatched.length === 0) return;

  // 5. Collect union of all notify_user_ids
  const userIdSet = new Set<string>();
  for (const c of allMatched) {
    for (const uid of c.notify_user_ids) {
      userIdSet.add(uid);
    }
  }
  const userIds = Array.from(userIdSet);

  // 6. Create consolidated notification
  const criteriaNames = allMatched.map((c) => ({ id: c.id, name: c.name }));
  const notificationData = {
    group_chat_id: group.id,
    group_name: group.group_name,
    group_chat_message_id: message.id,
    message_body: message.message_body,
    sender_phone: message.sender_phone,
    sender_name: message.sender_name,
    matched_criteria: criteriaNames,
  };

  const notificationTitle = `Group alert: ${group.group_name || group.group_jid}`;
  const notificationBody = allMatched.length === 1
    ? `Matched criteria: ${allMatched[0].name}`
    : `Matched ${allMatched.length} criteria: ${allMatched.map((c) => c.name).join(', ')}`;

  await createNotificationsForUsers(
    group.company_id,
    userIds,
    'group_criteria_match',
    notificationTitle,
    notificationBody,
    notificationData
  );

  // 7. Log the match
  // Note: notification_ids are not easily available from createNotificationsForUsers
  // since it doesn't return them. We store an empty array; the link is via metadata.
  await supabaseAdmin.from('group_criteria_matches').insert({
    company_id: group.company_id,
    group_chat_message_id: message.id,
    criteria_ids: allMatched.map((c) => c.id),
    notification_ids: [],
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/groupCriteriaService.ts
git commit -m "feat(groups): add criteria evaluation service with keyword and AI matching"
```

---

### Task 5: Update Notification Service

**Files:**
- Modify: `server/src/services/notificationService.ts:12-23` (add to PREFERENCE_DEFAULTS)

- [ ] **Step 1: Add group_criteria_match to PREFERENCE_DEFAULTS**

In `server/src/services/notificationService.ts`, add `group_criteria_match: true` to the `PREFERENCE_DEFAULTS` map (after the `handoff: true` line):

```typescript
const PREFERENCE_DEFAULTS: Record<string, boolean> = {
  assignment: true,
  share: true,
  message_assigned: true,
  message_accessible: false,
  snooze_set: true,
  schedule_set: true,
  schedule_sent: true,
  status_change: true,
  contact_note: true,
  handoff: true,
  group_criteria_match: true,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/notificationService.ts
git commit -m "feat(groups): register group_criteria_match notification type"
```

---

## Chunk 3: Backend — API Routes

### Task 6: Groups API Routes

**Files:**
- Create: `server/src/routes/groups.ts`
- Modify: `server/src/index.ts:92-121` (add route registration)

- [ ] **Step 1: Create the groups router**

Create `server/src/routes/groups.ts`:

```typescript
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// ── Static routes FIRST (before any /:id parameterized routes) ──

// GET /groups — List all group chats for the company
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch groups with channel name join and criteria count
    const { data: groups, error } = await supabaseAdmin
      .from('group_chats')
      .select('*, whatsapp_channels(name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get criteria counts per group
    const { data: criteriaCounts } = await supabaseAdmin
      .from('group_criteria')
      .select('group_chat_id')
      .eq('company_id', companyId)
      .eq('is_enabled', true);

    const countMap = new Map<string, number>();
    for (const c of criteriaCounts || []) {
      if (c.group_chat_id) {
        countMap.set(c.group_chat_id, (countMap.get(c.group_chat_id) || 0) + 1);
      }
    }

    const enriched = (groups || []).map((g: any) => ({
      ...g,
      channel_name: g.whatsapp_channels?.name ?? null,
      whatsapp_channels: undefined,
      criteria_count: countMap.get(g.id) || 0,
    }));

    res.json({ groups: enriched });
  } catch (err) {
    next(err);
  }
});

// GET /groups/global-criteria — List all global criteria
router.get('/global-criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .is('group_chat_id', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /groups/criteria — Create a new criteria
router.post('/criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      group_chat_id,
      name,
      match_type,
      keyword_config,
      ai_description,
      notify_user_ids,
      is_enabled,
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .insert({
        company_id: companyId,
        group_chat_id: group_chat_id || null,
        name,
        match_type,
        keyword_config: keyword_config || {},
        ai_description: ai_description || null,
        notify_user_ids: notify_user_ids || [],
        is_enabled: is_enabled ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /groups/criteria/:id — Update a criteria
router.patch('/criteria/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const {
      name,
      match_type,
      keyword_config,
      ai_description,
      notify_user_ids,
      is_enabled,
    } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (match_type !== undefined) updates.match_type = match_type;
    if (keyword_config !== undefined) updates.keyword_config = keyword_config;
    if (ai_description !== undefined) updates.ai_description = ai_description;
    if (notify_user_ids !== undefined) updates.notify_user_ids = notify_user_ids;
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /groups/criteria/:id — Delete a criteria
router.delete('/criteria/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('group_criteria')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Parameterized /:id routes LAST ─────────────────────────

// PATCH /groups/:id — Update group (toggle monitoring, etc.)
router.patch('/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { monitoring_enabled, group_name } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof monitoring_enabled === 'boolean') updates.monitoring_enabled = monitoring_enabled;
    if (typeof group_name === 'string') updates.group_name = group_name;

    const { data, error } = await supabaseAdmin
      .from('group_chats')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/messages — Get messages for a group (paginated)
router.get('/:id/messages', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { limit = '50', offset = '0', matched_only } = req.query;

    let query = supabaseAdmin
      .from('group_chat_messages')
      .select('*', { count: 'exact' })
      .eq('group_chat_id', id)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: messages, error, count } = await query;
    if (error) throw error;

    // If matched_only, filter to messages that have criteria matches
    let result = messages || [];
    if (matched_only === 'true') {
      const messageIds = result.map((m) => m.id);
      if (messageIds.length > 0) {
        const { data: matches } = await supabaseAdmin
          .from('group_criteria_matches')
          .select('group_chat_message_id, criteria_ids')
          .in('group_chat_message_id', messageIds);

        const matchedSet = new Set((matches || []).map((m) => m.group_chat_message_id));
        result = result.filter((m) => matchedSet.has(m.id));
      }
    }

    res.json({ messages: result, count });
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/criteria — List criteria for a specific group
router.get('/:id/criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .eq('group_chat_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/matches — Get criteria match log for a group
router.get('/:id/matches', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const { data: matches, error, count } = await supabaseAdmin
      .from('group_criteria_matches')
      .select(`
        *,
        group_chat_messages!inner (*)
      `, { count: 'exact' })
      .eq('company_id', companyId)
      .eq('group_chat_messages.group_chat_id', id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ matches: matches || [], count });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register the route in the main app**

In `server/src/index.ts`, add import at the top with other router imports:

```typescript
import groupsRouter from './routes/groups.js';
```

Add route registration in the `app.use` block (after the notifications line):

```typescript
app.use('/api/groups', groupsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/groups.ts server/src/index.ts
git commit -m "feat(groups): add API routes for groups, criteria, and matches"
```

---

## Chunk 4: Frontend — Hooks & API Layer

### Task 7: Groups API Hooks

**Files:**
- Create: `client/src/hooks/useGroups.ts`
- Create: `client/src/hooks/useGroupCriteria.ts`
- Create: `client/src/hooks/useGroupMessages.ts`
- Create: `client/src/hooks/useGroupRealtime.ts`

- [ ] **Step 1: Create useGroups hook**

Create `client/src/hooks/useGroups.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupChat } from '@/types/groups';

export function useGroups() {
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [loading, setLoading] = useState(true);

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

  const toggleMonitoring = useCallback(async (groupId: string, enabled: boolean) => {
    await api.patch(`/groups/${groupId}`, { monitoring_enabled: enabled });
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, monitoring_enabled: enabled } : g))
    );
  }, []);

  return { groups, loading, refetch: fetchGroups, toggleMonitoring };
}
```

- [ ] **Step 2: Create useGroupCriteria hook**

Create `client/src/hooks/useGroupCriteria.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupCriteria } from '@/types/groups';

export function useGroupCriteria(groupChatId?: string | null) {
  const [criteria, setCriteria] = useState<GroupCriteria[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCriteria = useCallback(async () => {
    try {
      const path = groupChatId
        ? `/groups/${groupChatId}/criteria`
        : '/groups/global-criteria';
      const { data } = await api.get(path);
      setCriteria(data.criteria || []);
    } catch (err) {
      console.error('Failed to fetch criteria:', err);
    } finally {
      setLoading(false);
    }
  }, [groupChatId]);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  const createCriteria = useCallback(
    async (values: Partial<GroupCriteria>) => {
      const { data } = await api.post('/groups/criteria', {
        ...values,
        group_chat_id: groupChatId || null,
      });
      setCriteria((prev) => [data, ...prev]);
      return data;
    },
    [groupChatId]
  );

  const updateCriteria = useCallback(async (id: string, values: Partial<GroupCriteria>) => {
    const { data } = await api.patch(`/groups/criteria/${id}`, values);
    setCriteria((prev) => prev.map((c) => (c.id === id ? data : c)));
    return data;
  }, []);

  const deleteCriteria = useCallback(async (id: string) => {
    await api.delete(`/groups/criteria/${id}`);
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { criteria, loading, refetch: fetchCriteria, createCriteria, updateCriteria, deleteCriteria };
}
```

- [ ] **Step 3: Create useGroupMessages hook**

Create `client/src/hooks/useGroupMessages.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { GroupChatMessage, GroupCriteriaMatch } from '@/types/groups';

export function useGroupMessages(groupId: string | null) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [matches, setMatches] = useState<GroupCriteriaMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!groupId) return;
    try {
      const [msgRes, matchRes] = await Promise.all([
        api.get(`/groups/${groupId}/messages`),
        api.get(`/groups/${groupId}/matches`),
      ]);
      setMessages(msgRes.data.messages || []);
      setMatches(matchRes.data.matches || []);
    } catch (err) {
      console.error('Failed to fetch group messages:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (groupId) {
      setLoading(true);
      fetchMessages();
    }
  }, [groupId, fetchMessages]);

  return { messages, matches, loading, refetch: fetchMessages, setMessages };
}
```

- [ ] **Step 4: Create useGroupRealtime hook**

Create `client/src/hooks/useGroupRealtime.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import type { GroupChatMessage, GroupCriteriaMatch } from '@/types/groups';

interface UseGroupRealtimeOptions {
  onNewMessage?: (message: GroupChatMessage) => void;
  onNewMatch?: (match: GroupCriteriaMatch) => void;
}

export function useGroupRealtime({ onNewMessage, onNewMatch }: UseGroupRealtimeOptions) {
  const { companyId } = useSession();
  const onNewMessageRef = useRef(onNewMessage);
  const onNewMatchRef = useRef(onNewMatch);

  onNewMessageRef.current = onNewMessage;
  onNewMatchRef.current = onNewMatch;

  useEffect(() => {
    if (!companyId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`groups-realtime-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_chat_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onNewMessageRef.current?.(payload.new as GroupChatMessage);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_criteria_matches',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onNewMatchRef.current?.(payload.new as GroupCriteriaMatch);
          }
        }
      )
      .subscribe((status, err) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          console.log('[groups-realtime] connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[groups-realtime] channel error:', err);
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId]);
}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useGroups.ts client/src/hooks/useGroupCriteria.ts client/src/hooks/useGroupMessages.ts client/src/hooks/useGroupRealtime.ts
git commit -m "feat(groups): add frontend hooks for groups, criteria, messages, and realtime"
```

---

## Chunk 5: Frontend — Groups Page & Components

### Task 8: Groups Page Shell & Routing

**Files:**
- Create: `client/src/pages/GroupsPage.tsx`
- Modify: `client/src/components/layout/Sidebar.tsx:21-29` (add nav item)
- Modify: App router file (add route for `/groups`)

- [ ] **Step 1: Identify the app router file**

Check `client/src/App.tsx` or `client/src/router.tsx` for the route definitions. Add the `/groups` route alongside existing routes.

- [ ] **Step 2: Create the GroupsPage component**

Create `client/src/pages/GroupsPage.tsx`:

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GroupsList } from '@/components/groups/GroupsList';
import { GlobalCriteriaList } from '@/components/groups/GlobalCriteriaList';
import { GroupDetail } from '@/components/groups/GroupDetail';

export default function GroupsPage() {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  if (selectedGroupId) {
    return (
      <GroupDetail
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">Groups</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor WhatsApp group chats and configure alert criteria
        </p>
      </div>

      <Tabs defaultValue="groups" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="global-criteria">Global Criteria</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="groups" className="flex-1 p-6">
          <GroupsList onSelectGroup={setSelectedGroupId} />
        </TabsContent>

        <TabsContent value="global-criteria" className="flex-1 p-6">
          <GlobalCriteriaList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Add to sidebar navigation**

In `client/src/components/layout/Sidebar.tsx`, add to the `navItems` array (after 'Channels'):

```typescript
{ to: '/groups', icon: UsersRound, label: 'Groups' },
```

Add the import for the icon:

```typescript
import { UsersRound } from 'lucide-react';
```

- [ ] **Step 4: Add route to the app router**

Add to the route definitions (check the exact file — likely `App.tsx` or a router config):

```tsx
<Route path="/groups" element={<GroupsPage />} />
```

With lazy import:

```tsx
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/GroupsPage.tsx client/src/components/layout/Sidebar.tsx
git commit -m "feat(groups): add Groups page shell with routing and sidebar nav"
```

---

### Task 9: GroupsList Component

**Files:**
- Create: `client/src/components/groups/GroupsList.tsx`

- [ ] **Step 1: Create the GroupsList component**

Create `client/src/components/groups/GroupsList.tsx`:

```tsx
import { useGroups } from '@/hooks/useGroups';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { GroupChat } from '@/types/groups';

interface GroupsListProps {
  onSelectGroup: (groupId: string) => void;
}

export function GroupsList({ onSelectGroup }: GroupsListProps) {
  const { groups, loading, toggleMonitoring } = useGroups();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No groups discovered yet</p>
        <p className="text-sm mt-1">
          Groups will appear here automatically when messages are received from WhatsApp group chats.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <GroupRow
          key={group.id}
          group={group}
          onSelect={() => onSelectGroup(group.id)}
          onToggleMonitoring={(enabled) => toggleMonitoring(group.id, enabled)}
        />
      ))}
    </div>
  );
}

function GroupRow({
  group,
  onSelect,
  onToggleMonitoring,
}: {
  group: GroupChat;
  onSelect: () => void;
  onToggleMonitoring: (enabled: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {group.group_name || group.group_jid}
          </span>
          {group.criteria_count && group.criteria_count > 0 ? (
            <Badge variant="secondary">{group.criteria_count} criteria</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground truncate mt-0.5">
          {group.group_jid}
        </p>
      </div>

      <div
        className="flex items-center gap-2 ml-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          {group.monitoring_enabled ? 'Monitoring' : 'Off'}
        </span>
        <Switch
          checked={group.monitoring_enabled}
          onCheckedChange={onToggleMonitoring}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/GroupsList.tsx
git commit -m "feat(groups): add GroupsList component with monitoring toggle"
```

---

### Task 10: CriteriaCard & CriteriaDialog Components

**Files:**
- Create: `client/src/components/groups/CriteriaCard.tsx`
- Create: `client/src/components/groups/CriteriaDialog.tsx`

- [ ] **Step 1: Create CriteriaCard**

Create `client/src/components/groups/CriteriaCard.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import type { GroupCriteria } from '@/types/groups';

interface CriteriaCardProps {
  criteria: GroupCriteria;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}

export function CriteriaCard({ criteria, onEdit, onDelete, onToggle }: CriteriaCardProps) {
  return (
    <div className="flex items-start justify-between p-4 border rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{criteria.name}</span>
          <Badge variant={criteria.match_type === 'ai' ? 'default' : 'secondary'}>
            {criteria.match_type === 'ai' ? 'AI' : 'Keyword'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {criteria.match_type === 'keyword'
            ? `Keywords: ${criteria.keyword_config?.keywords?.join(', ') || 'none'} (${criteria.keyword_config?.operator || 'or'})`
            : criteria.ai_description || 'No description'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Notifies {criteria.notify_user_ids.length} team member{criteria.notify_user_ids.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <Switch
          checked={criteria.is_enabled}
          onCheckedChange={onToggle}
        />
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CriteriaDialog**

Create `client/src/components/groups/CriteriaDialog.tsx`:

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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import type { GroupCriteria } from '@/types/groups';

interface CriteriaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  criteria?: GroupCriteria | null;
  onSave: (values: Partial<GroupCriteria>) => Promise<void>;
}

export function CriteriaDialog({ open, onOpenChange, criteria, onSave }: CriteriaDialogProps) {
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'keyword' | 'ai'>('keyword');
  const [keywords, setKeywords] = useState('');
  const [operator, setOperator] = useState<'and' | 'or'>('or');
  const [aiDescription, setAiDescription] = useState('');
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (criteria) {
      setName(criteria.name);
      setMatchType(criteria.match_type);
      setKeywords(criteria.keyword_config?.keywords?.join(', ') || '');
      setOperator(criteria.keyword_config?.operator || 'or');
      setAiDescription(criteria.ai_description || '');
      setNotifyUserIds(criteria.notify_user_ids);
      setIsEnabled(criteria.is_enabled);
    } else {
      setName('');
      setMatchType('keyword');
      setKeywords('');
      setOperator('or');
      setAiDescription('');
      setNotifyUserIds([]);
      setIsEnabled(true);
    }
  }, [criteria, open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        match_type: matchType,
        keyword_config:
          matchType === 'keyword'
            ? {
                keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
                operator,
              }
            : { keywords: [], operator: 'or' },
        ai_description: matchType === 'ai' ? aiDescription : null,
        notify_user_ids: notifyUserIds,
        is_enabled: isEnabled,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{criteria ? 'Edit Criteria' : 'New Criteria'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="criteria-name">Name</Label>
            <Input
              id="criteria-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Urgent complaints"
            />
          </div>

          <div>
            <Label>Match Type</Label>
            <Select value={matchType} onValueChange={(v) => setMatchType(v as 'keyword' | 'ai')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword</SelectItem>
                <SelectItem value="ai">AI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {matchType === 'keyword' ? (
            <>
              <div>
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g., urgent, help needed, complaint"
                />
              </div>
              <div>
                <Label>Logic</Label>
                <Select value={operator} onValueChange={(v) => setOperator(v as 'and' | 'or')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="or">Match ANY keyword (OR)</SelectItem>
                    <SelectItem value="and">Match ALL keywords (AND)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="ai-desc">AI Description</Label>
              <Textarea
                id="ai-desc"
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="Describe what the AI should look for, e.g., 'Someone is complaining about delivery delays'"
                rows={3}
              />
            </div>
          )}

          <div>
            <Label>Notify Team Members</Label>
            <TeamMemberMultiSelect
              value={notifyUserIds}
              onChange={setNotifyUserIds}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            <Label>Enabled</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : criteria ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/groups/CriteriaCard.tsx client/src/components/groups/CriteriaDialog.tsx
git commit -m "feat(groups): add CriteriaCard and CriteriaDialog components"
```

---

### Task 11: TeamMemberMultiSelect Component

**Files:**
- Create: `client/src/components/groups/TeamMemberMultiSelect.tsx`

- [ ] **Step 1: Check how team members are fetched elsewhere in the codebase**

Look at `client/src/hooks/useTeam.ts` or similar to find the existing pattern for fetching team members. The component should use that existing hook.

- [ ] **Step 2: Create TeamMemberMultiSelect**

Create `client/src/components/groups/TeamMemberMultiSelect.tsx`. This wraps the existing team members data into a multi-select dropdown. Implementation depends on what multi-select component exists in the project (check for existing `MultiSelect` or use Radix `Popover` + checkboxes pattern matching other multi-selects in the codebase).

The component should:
- Accept `value: string[]` and `onChange: (ids: string[]) => void`
- Fetch team members using the existing team hook
- Display member names with checkboxes
- Show selected count

- [ ] **Step 3: Commit**

```bash
git add client/src/components/groups/TeamMemberMultiSelect.tsx
git commit -m "feat(groups): add TeamMemberMultiSelect component"
```

---

### Task 12: GlobalCriteriaList Component

**Files:**
- Create: `client/src/components/groups/GlobalCriteriaList.tsx`

- [ ] **Step 1: Create GlobalCriteriaList**

Create `client/src/components/groups/GlobalCriteriaList.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useGroupCriteria } from '@/hooks/useGroupCriteria';
import { CriteriaCard } from './CriteriaCard';
import { CriteriaDialog } from './CriteriaDialog';
import type { GroupCriteria } from '@/types/groups';
import { Loader2 } from 'lucide-react';

export function GlobalCriteriaList() {
  const { criteria, loading, createCriteria, updateCriteria, deleteCriteria } =
    useGroupCriteria(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupCriteria | null>(null);

  const handleSave = async (values: Partial<GroupCriteria>) => {
    if (editing) {
      await updateCriteria(editing.id, values);
    } else {
      await createCriteria(values);
    }
    setEditing(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium">Global Criteria</h2>
          <p className="text-sm text-muted-foreground">
            These criteria apply across all monitored groups.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Criteria
        </Button>
      </div>

      {criteria.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No global criteria configured yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {criteria.map((c) => (
            <CriteriaCard
              key={c.id}
              criteria={c}
              onEdit={() => { setEditing(c); setDialogOpen(true); }}
              onDelete={() => deleteCriteria(c.id)}
              onToggle={(enabled) => updateCriteria(c.id, { is_enabled: enabled })}
            />
          ))}
        </div>
      )}

      <CriteriaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        criteria={editing}
        onSave={handleSave}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/GlobalCriteriaList.tsx
git commit -m "feat(groups): add GlobalCriteriaList component"
```

---

### Task 13: GroupDetail Component

**Files:**
- Create: `client/src/components/groups/GroupDetail.tsx`

- [ ] **Step 1: Create GroupDetail**

Create `client/src/components/groups/GroupDetail.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroups } from '@/hooks/useGroups';
import { useGroupCriteria } from '@/hooks/useGroupCriteria';
import { useGroupMessages } from '@/hooks/useGroupMessages';
import { useGroupRealtime } from '@/hooks/useGroupRealtime';
import { CriteriaCard } from './CriteriaCard';
import { CriteriaDialog } from './CriteriaDialog';
import type { GroupCriteria, GroupChatMessage } from '@/types/groups';

interface GroupDetailProps {
  groupId: string;
  onBack: () => void;
}

export function GroupDetail({ groupId, onBack }: GroupDetailProps) {
  const { groups, toggleMonitoring } = useGroups();
  const group = groups.find((g) => g.id === groupId);
  const { criteria, createCriteria, updateCriteria, deleteCriteria } =
    useGroupCriteria(groupId);
  const { messages, matches, loading: messagesLoading, setMessages } =
    useGroupMessages(groupId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupCriteria | null>(null);

  // Real-time: append new messages and matches
  useGroupRealtime({
    onNewMessage: (msg) => {
      if (msg.group_chat_id === groupId) {
        setMessages((prev) => [msg, ...prev]);
      }
    },
  });

  if (!group) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="mt-4 text-muted-foreground">Group not found.</p>
      </div>
    );
  }

  const handleSave = async (values: Partial<GroupCriteria>) => {
    if (editing) {
      await updateCriteria(editing.id, values);
    } else {
      await createCriteria(values);
    }
    setEditing(null);
  };

  // Build a set of matched message IDs for highlighting
  const matchedMessageIds = new Set(
    matches.map((m) => m.group_chat_message_id)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Groups
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {group.group_name || group.group_jid}
            </h1>
            <p className="text-sm text-muted-foreground">{group.group_jid}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Monitoring</span>
            <Switch
              checked={group.monitoring_enabled}
              onCheckedChange={(enabled) => toggleMonitoring(group.id, enabled)}
            />
          </div>
        </div>
      </div>

      {/* Content tabs */}
      <Tabs defaultValue="criteria" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="criteria">Criteria</TabsTrigger>
            <TabsTrigger value="messages">Matched Messages</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="criteria" className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Group Criteria</h2>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Criteria
            </Button>
          </div>

          {criteria.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No criteria configured for this group.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {criteria.map((c) => (
                <CriteriaCard
                  key={c.id}
                  criteria={c}
                  onEdit={() => { setEditing(c); setDialogOpen(true); }}
                  onDelete={() => deleteCriteria(c.id)}
                  onToggle={(enabled) => updateCriteria(c.id, { is_enabled: enabled })}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="flex-1 p-6">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {messages
                .filter((m) => matchedMessageIds.has(m.id))
                .map((msg) => (
                  <MatchedMessageRow key={msg.id} message={msg} />
                ))}
              {messages.filter((m) => matchedMessageIds.has(m.id)).length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No matched messages yet.</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CriteriaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        criteria={editing}
        onSave={handleSave}
      />
    </div>
  );
}

function MatchedMessageRow({ message }: { message: GroupChatMessage }) {
  return (
    <div className="p-4 border rounded-lg border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm">
          {message.sender_name || message.sender_phone || 'Unknown'}
        </span>
        {message.sender_phone && message.sender_name && (
          <span className="text-xs text-muted-foreground">{message.sender_phone}</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm">{message.message_body}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/groups/GroupDetail.tsx
git commit -m "feat(groups): add GroupDetail component with criteria and matched messages"
```

---

## Chunk 6: Notification Click Navigation

### Task 14: Handle group_criteria_match Notification Clicks

**Files:**
- Modify: `client/src/components/layout/NotificationBell.tsx:20-30` (add icon)
- Modify: `client/src/components/layout/NotificationBell.tsx:91-118` (add click handler)

- [ ] **Step 1: Add icon for group_criteria_match**

In `NotificationBell.tsx`, add to the `TYPE_ICONS` map (line ~20-30):

```typescript
group_criteria_match: UsersRound,
```

Add the import:

```typescript
import { UsersRound } from 'lucide-react';
```

- [ ] **Step 2: Add click handler for group_criteria_match**

In the `handleClickNotification` function (line ~91-118), add a case before the existing `conversationId` check:

```typescript
if (notification.type === 'group_criteria_match') {
  const groupChatId = notification.data?.group_chat_id as string | undefined;
  if (groupChatId) {
    navigate(`/groups?group=${groupChatId}`);
  } else {
    navigate('/groups');
  }
  return;
}
```

- [ ] **Step 3: Update GroupsPage to read the query param**

In `client/src/pages/GroupsPage.tsx`, add URL param handling:

```tsx
import { useSearchParams } from 'react-router-dom';

// Inside the component:
const [searchParams, setSearchParams] = useSearchParams();
const groupFromUrl = searchParams.get('group');

const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groupFromUrl);

// When setting selectedGroupId, also update the URL:
const selectGroup = (id: string | null) => {
  setSelectedGroupId(id);
  if (id) {
    setSearchParams({ group: id });
  } else {
    setSearchParams({});
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/layout/NotificationBell.tsx client/src/pages/GroupsPage.tsx
git commit -m "feat(groups): handle group_criteria_match notification click navigation"
```

---

## Chunk 7: Build & Verify

### Task 15: TypeScript Build Check

- [ ] **Step 1: Run TypeScript check**

Run: `npm run build --prefix c:/dev/reply-flow`
Expected: No type errors.

- [ ] **Step 2: Fix any type errors**

If there are errors, fix them in the relevant files.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev --prefix c:/dev/reply-flow`

Verify:
1. The Groups link appears in the sidebar
2. The `/groups` page loads with both tabs
3. No console errors on page load

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(groups): address build errors from group chat criteria implementation"
```

---

## Task Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database migration | `supabase/migrations/063_group_chat_criteria.sql` |
| 2 | TypeScript types | `server/src/types/index.ts`, `client/src/types/groups.ts` |
| 3 | Webhook group ingestion | `server/src/routes/webhook.ts`, `server/src/services/groupMessageProcessor.ts` |
| 4 | Criteria evaluation service | `server/src/services/groupCriteriaService.ts` |
| 5 | Notification service update | `server/src/services/notificationService.ts` |
| 6 | Groups API routes | `server/src/routes/groups.ts`, `server/src/index.ts` |
| 7 | Frontend hooks | `client/src/hooks/useGroups.ts`, `useGroupCriteria.ts`, `useGroupMessages.ts`, `useGroupRealtime.ts` |
| 8 | Groups page shell & routing | `client/src/pages/GroupsPage.tsx`, `Sidebar.tsx`, router |
| 9 | GroupsList component | `client/src/components/groups/GroupsList.tsx` |
| 10 | CriteriaCard & CriteriaDialog | `client/src/components/groups/CriteriaCard.tsx`, `CriteriaDialog.tsx` |
| 11 | TeamMemberMultiSelect | `client/src/components/groups/TeamMemberMultiSelect.tsx` |
| 12 | GlobalCriteriaList | `client/src/components/groups/GlobalCriteriaList.tsx` |
| 13 | GroupDetail | `client/src/components/groups/GroupDetail.tsx` |
| 14 | Notification click navigation | `NotificationBell.tsx`, `GroupsPage.tsx` |
| 15 | Build & verify | All files |
