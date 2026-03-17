# AI Auto-Classification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI classification system that auto-labels conversations with labels, priority, status, contact tags, and contact list membership using Claude Haiku.

**Architecture:** Single Claude Haiku API call with tool_use structured output. Classification runs fire-and-forget on new inbound messages, and on-demand via an "Analyze" button. Results either auto-apply or appear as suggestions in the side panel depending on company config.

**Tech Stack:** Anthropic SDK (Haiku), Express routes, Supabase (Postgres + RLS), React hooks, shadcn UI components.

**Spec:** `docs/superpowers/specs/2026-03-17-ai-auto-classification-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/065_ai_classification.sql` | DB migration: `classification_suggestions` table, `companies.classification_mode` column, RLS, indexes |
| `server/src/services/classification.ts` | Core classification logic: prompt building, Haiku API call, entity validation, apply/store |
| `server/src/routes/classification.ts` | Express router: classify, suggestions CRUD, settings endpoints |
| `client/src/hooks/useClassificationSuggestions.ts` | Data-fetching hook for suggestions + classify action |
| `client/src/components/inbox/ClassificationCard.tsx` | Side panel card: pending suggestions, accept/dismiss, applied state |
| `client/src/components/agents/ClassificationSettings.tsx` | Agent editor section: enable toggle, rules textarea |
| `client/src/components/settings/ClassificationModeSettings.tsx` | Company setting: auto-apply vs suggest mode |

### Modified Files

| File | Change |
|------|--------|
| `server/src/types/index.ts` | Add `ClassificationSuggestion`, `ClassificationConfig`, `PartialAccept` interfaces |
| `server/src/index.ts` | Import + register `/api/classification` router |
| `server/src/services/messageProcessor.ts` | Add auto-classify hook after message insertion (~line 595) |
| `client/src/components/inbox/ContactPanel.tsx` | Mount `<ClassificationCard>` |
| `client/src/components/inbox/ConversationHeader.tsx` | Add "Analyze" button |
| `client/src/components/settings/AIAgentSections.tsx` | Mount `<ClassificationSettings>` section |
| `client/src/components/settings/ConversationSettingsTab.tsx` | Mount `<ClassificationModeSettings>` section |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/065_ai_classification.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 065_ai_classification.sql
-- AI auto-classification: suggestions table + company classification_mode

-- 1. classification_suggestions table
CREATE TABLE IF NOT EXISTS classification_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'applied')),
  suggestions JSONB NOT NULL,
  accepted_items JSONB,
  applied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_classification_suggestions_session
  ON classification_suggestions (session_id) WHERE status = 'pending';
CREATE INDEX idx_classification_suggestions_company
  ON classification_suggestions (company_id);

-- Auto-update updated_at
CREATE TRIGGER set_classification_suggestions_updated_at
  BEFORE UPDATE ON classification_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE classification_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classification_suggestions_select"
  ON classification_suggestions FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "classification_suggestions_insert"
  ON classification_suggestions FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "classification_suggestions_update"
  ON classification_suggestions FOR UPDATE
  USING (company_id = get_user_company_id());

-- 2. Add classification_mode to companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_mode TEXT NOT NULL DEFAULT 'suggest'
  CHECK (classification_mode IN ('auto_apply', 'suggest'));
```

- [ ] **Step 2: Verify migration is valid SQL**

Run: `grep -c "CREATE TABLE" supabase/migrations/065_ai_classification.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/065_ai_classification.sql
git commit -m "feat(classification): add migration for classification_suggestions table and company mode"
```

---

## Task 2: TypeScript Interfaces

**Files:**
- Modify: `server/src/types/index.ts`

- [ ] **Step 1: Add classification interfaces**

Append to the end of `server/src/types/index.ts`:

```typescript
export interface ClassificationSuggestionItem {
  id: string;
  confidence: number;
  name?: string;
}

export interface ClassificationSuggestions {
  labels?: ClassificationSuggestionItem[];
  priority?: ClassificationSuggestionItem;
  status?: ClassificationSuggestionItem;
  contact_tags?: ClassificationSuggestionItem[];
  contact_lists?: ClassificationSuggestionItem[];
  reasoning: string;
}

export interface ClassificationSuggestion {
  id: string;
  company_id: string;
  session_id: string;
  contact_id: string;
  trigger: 'auto' | 'manual';
  status: 'pending' | 'accepted' | 'dismissed' | 'applied';
  suggestions: ClassificationSuggestions;
  accepted_items: Partial<ClassificationSuggestions> | null;
  applied_by: string | null;
  created_at: string;
  applied_at: string | null;
  updated_at: string;
}

export interface ClassificationConfig {
  enabled: boolean;
  rules: string;
  auto_classify_new: boolean;
}

export interface PartialAccept {
  labels?: string[];
  priority?: boolean;
  status?: boolean;
  contact_tags?: string[];
  contact_lists?: string[];
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -5`
Expected: No errors related to types/index.ts

- [ ] **Step 3: Commit**

```bash
git add server/src/types/index.ts
git commit -m "feat(classification): add TypeScript interfaces for classification"
```

---

## Task 3: Classification Service

**Files:**
- Create: `server/src/services/classification.ts`

This is the core of the feature. It handles:
- Gathering conversation context + available entities
- Building the Haiku prompt with tool_use
- Validating and filtering the AI response
- Applying results or storing as pending suggestions

**Reference files to study:**
- `server/src/services/ai.ts:1-20` — Anthropic client setup, model constants
- `server/src/services/ai.ts` — `classifyMessage()` for existing Haiku + tool_use pattern
- `server/src/services/sessionMemory.ts` — `getContactContext()` for contact history
- `server/src/routes/labels.ts:169-201` — how `conversation_labels` upserts work
- `server/src/routes/conversationPriorities.ts:9-14` — default priority names

- [ ] **Step 1: Create the service file with imports and constants**

Create `server/src/services/classification.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { getContactContext } from './sessionMemory.js';
import type {
  ClassificationSuggestion,
  ClassificationSuggestions,
  ClassificationSuggestionItem,
  PartialAccept,
} from '../types/index.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const CONFIDENCE_THRESHOLD = 0.3;
const MAX_LABELS = 5;
const MAX_MESSAGES = 50;
const DEDUP_WINDOW_SECONDS = 60;
```

- [ ] **Step 2: Add the tool definition constant**

Append to the same file:

```typescript
const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'classify_conversation',
  description: 'Classify the conversation based on its content and context',
  input_schema: {
    type: 'object' as const,
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['id', 'confidence'],
        },
      },
      priority: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['id', 'confidence'],
      },
      status: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['id', 'confidence'],
      },
      contact_tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['id', 'confidence'],
        },
      },
      contact_lists: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['id', 'confidence'],
        },
      },
      reasoning: { type: 'string' },
    },
    required: ['reasoning'],
  },
};
```

- [ ] **Step 3: Add helper to fetch available entities**

```typescript
async function fetchAvailableEntities(companyId: string) {
  const [labelsRes, prioritiesRes, statusesRes, tagsRes, listsRes] = await Promise.all([
    supabaseAdmin.from('labels').select('id, name').eq('company_id', companyId).eq('visibility', 'company').order('name').limit(50),
    supabaseAdmin.from('conversation_priorities').select('id, name, is_default').eq('company_id', companyId).eq('is_deleted', false).order('sort_order'),
    supabaseAdmin.from('conversation_statuses').select('id, name, "group"').eq('company_id', companyId).eq('is_deleted', false).order('sort_order'),
    supabaseAdmin.from('contact_tags').select('id, name').eq('company_id', companyId).eq('is_deleted', false).order('name'),
    supabaseAdmin.from('contact_lists').select('id, name').eq('company_id', companyId).eq('is_deleted', false).order('name'),
  ]);

  return {
    labels: labelsRes.data || [],
    priorities: prioritiesRes.data || [],
    statuses: statusesRes.data || [],
    contactTags: tagsRes.data || [],
    contactLists: listsRes.data || [],
  };
}
```

- [ ] **Step 4: Add helper to build the prompt**

```typescript
async function buildClassificationPrompt(
  sessionId: string,
  companyId: string,
  contactId: string,
  rules: string | undefined,
  entities: Awaited<ReturnType<typeof fetchAvailableEntities>>,
): Promise<string> {
  // Fetch current session messages (capped)
  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('message_body, direction, sender_type, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES);

  // Fetch contact info
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('first_name, last_name, phone_number, email, company, tags')
    .eq('id', contactId)
    .single();

  // Fetch contact history (last 5 sessions, excluding current)
  const { data: pastSessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('last_message, status, created_at, conversation_labels(labels(name))')
    .eq('contact_id', contactId)
    .eq('company_id', companyId)
    .neq('id', sessionId)
    .order('created_at', { ascending: false })
    .limit(5);

  const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Unknown';

  let prompt = `## Admin Classification Rules\n${rules || 'No specific rules configured.'}\n\n`;

  prompt += `## Contact Information\nName: ${contactName}\nPhone: ${contact?.phone_number || 'N/A'}\nEmail: ${contact?.email || 'N/A'}\nCompany: ${contact?.company || 'N/A'}\nExisting Tags: ${(contact?.tags || []).join(', ') || 'None'}\n\n`;

  if (pastSessions && pastSessions.length > 0) {
    prompt += `## Contact History (Last ${pastSessions.length} Conversations)\n`;
    for (const session of pastSessions) {
      const labels = (session.conversation_labels as Array<{ labels: { name: string } }>)
        ?.map((cl) => cl.labels?.name).filter(Boolean).join(', ') || 'None';
      prompt += `- ${session.created_at}: Status: ${session.status}, Labels: ${labels}, Last message: "${(session.last_message || '').slice(0, 100)}"\n`;
    }
    prompt += '\n';
  }

  prompt += `## Current Conversation\n`;
  for (const msg of messages || []) {
    const sender = msg.sender_type === 'contact' ? contactName : msg.sender_type === 'ai' ? 'AI Agent' : 'Team Member';
    prompt += `[${sender}]: ${msg.message_body || '(media)'}\n`;
  }

  prompt += `\n## Available Classification Options\n`;
  prompt += `Labels: ${JSON.stringify(entities.labels.map((l) => ({ id: l.id, name: l.name })))}\n`;
  prompt += `Priorities: ${JSON.stringify(entities.priorities.map((p) => ({ id: p.id, name: p.name })))}\n`;
  prompt += `Statuses: ${JSON.stringify(entities.statuses.map((s) => ({ id: s.id, name: s.name, group: (s as Record<string, unknown>).group })))}\n`;
  prompt += `Contact Tags: ${JSON.stringify(entities.contactTags.map((t) => ({ id: t.id, name: t.name })))}\n`;
  prompt += `Contact Lists: ${JSON.stringify(entities.contactLists.map((l) => ({ id: l.id, name: l.name })))}\n`;

  return prompt;
}
```

- [ ] **Step 5: Add response validation and filtering**

```typescript
function validateAndFilter(
  raw: Record<string, unknown>,
  entities: Awaited<ReturnType<typeof fetchAvailableEntities>>,
): ClassificationSuggestions {
  const validIds = new Set([
    ...entities.labels.map((l) => l.id),
    ...entities.priorities.map((p) => p.id),
    ...entities.statuses.map((s) => s.id),
    ...entities.contactTags.map((t) => t.id),
    ...entities.contactLists.map((l) => l.id),
  ]);

  const nameMap = new Map<string, string>();
  for (const e of [...entities.labels, ...entities.priorities, ...entities.statuses, ...entities.contactTags, ...entities.contactLists]) {
    nameMap.set(e.id, e.name);
  }

  const filterItems = (items: unknown): ClassificationSuggestionItem[] | undefined => {
    if (!Array.isArray(items)) return undefined;
    return items
      .filter((item) => item && typeof item === 'object' && validIds.has(item.id) && item.confidence >= CONFIDENCE_THRESHOLD)
      .map((item) => ({ id: item.id, confidence: item.confidence, name: nameMap.get(item.id) }));
  };

  const filterSingle = (item: unknown): ClassificationSuggestionItem | undefined => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('confidence' in item)) return undefined;
    const typed = item as { id: string; confidence: number };
    if (!validIds.has(typed.id) || typed.confidence < CONFIDENCE_THRESHOLD) return undefined;
    return { id: typed.id, confidence: typed.confidence, name: nameMap.get(typed.id) };
  };

  const labels = filterItems(raw.labels)?.slice(0, MAX_LABELS);

  return {
    labels: labels && labels.length > 0 ? labels : undefined,
    priority: filterSingle(raw.priority),
    status: filterSingle(raw.status),
    contact_tags: filterItems(raw.contact_tags),
    contact_lists: filterItems(raw.contact_lists),
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : 'No reasoning provided.',
  };
}
```

- [ ] **Step 6: Add the applySuggestionItems helper**

This helper applies classification results to the DB — used by both auto-apply and manual accept.

```typescript
async function applySuggestionItems(
  suggestions: ClassificationSuggestions,
  sessionId: string,
  contactId: string,
  companyId: string,
  partial?: PartialAccept,
) {
  // Labels — insert into conversation_labels
  const labelsToApply = partial?.labels
    ? suggestions.labels?.filter((l) => partial.labels!.includes(l.id))
    : suggestions.labels;

  if (labelsToApply && labelsToApply.length > 0) {
    for (const label of labelsToApply) {
      await supabaseAdmin
        .from('conversation_labels')
        .upsert({ session_id: sessionId, label_id: label.id });
    }
  }

  // Priority — update chat_sessions.priority (only if current is default or partial accepts it)
  const applyPriority = partial ? partial.priority : true;
  if (applyPriority && suggestions.priority) {
    const { data: currentPriority } = await supabaseAdmin
      .from('conversation_priorities')
      .select('is_default')
      .eq('company_id', companyId)
      .eq('name', (await supabaseAdmin.from('chat_sessions').select('priority').eq('id', sessionId).single()).data?.priority || '')
      .single();

    // Only apply if current priority is the default
    if (!partial && currentPriority?.is_default === false) {
      // Skip — non-default already set (auto-apply mode respects no-override)
    } else {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ priority: suggestions.priority.name, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }
  }

  // Status — update chat_sessions.status (same no-override logic)
  const applyStatus = partial ? partial.status : true;
  if (applyStatus && suggestions.status) {
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();

    const { data: currentStatus } = await supabaseAdmin
      .from('conversation_statuses')
      .select('is_default')
      .eq('company_id', companyId)
      .eq('name', session?.status || '')
      .single();

    if (!partial && currentStatus?.is_default === false) {
      // Skip — non-default already set
    } else {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ status: suggestions.status.name, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }
  }

  // Contact tags — merge into contacts.tags array
  const tagsToApply = partial?.contact_tags
    ? suggestions.contact_tags?.filter((t) => partial.contact_tags!.includes(t.id))
    : suggestions.contact_tags;

  if (tagsToApply && tagsToApply.length > 0) {
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('tags')
      .eq('id', contactId)
      .single();

    const existingTags: string[] = contact?.tags || [];
    const newTagNames = tagsToApply.map((t) => t.name!).filter((name) => name && !existingTags.includes(name));

    if (newTagNames.length > 0) {
      await supabaseAdmin
        .from('contacts')
        .update({ tags: [...existingTags, ...newTagNames], updated_at: new Date().toISOString() })
        .eq('id', contactId);
    }
  }

  // Contact lists — insert into contact_list_members
  const listsToApply = partial?.contact_lists
    ? suggestions.contact_lists?.filter((l) => partial.contact_lists!.includes(l.id))
    : suggestions.contact_lists;

  if (listsToApply && listsToApply.length > 0) {
    for (const list of listsToApply) {
      await supabaseAdmin
        .from('contact_list_members')
        .upsert(
          { list_id: list.id, contact_id: contactId },
          { onConflict: 'list_id,contact_id' },
        );
    }
  }
}
```

- [ ] **Step 7: Add the main classifyConversation function**

```typescript
export async function classifyConversation(
  sessionId: string,
  companyId: string,
  trigger: 'auto' | 'manual',
): Promise<ClassificationSuggestion | null> {
  if (!anthropic) throw new Error('Anthropic API key not configured');

  // Fetch session to get channel_id and contact_id
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, contact_id')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (!session?.contact_id) return null;

  // Fetch channel agent settings
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('agent_id')
    .eq('channel_id', session.channel_id!)
    .single();

  if (!channelSettings?.agent_id) return null;

  // Fetch agent classification config
  const { data: agent } = await supabaseAdmin
    .from('ai_agents')
    .select('profile_data')
    .eq('id', channelSettings.agent_id)
    .single();

  const classificationConfig = (agent?.profile_data as Record<string, unknown>)?.classification as Record<string, unknown> | undefined;
  if (!classificationConfig?.enabled) return null;

  // Deduplication check (for auto trigger)
  if (trigger === 'auto') {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from('classification_suggestions')
      .select('id')
      .eq('session_id', sessionId)
      .in('status', ['pending', 'applied'])
      .gte('created_at', cutoff)
      .limit(1);

    if (existing && existing.length > 0) return null;
  }

  // Fetch available entities
  const entities = await fetchAvailableEntities(companyId);

  // Empty entity guard
  const hasUsefulEntities = entities.labels.length > 0 ||
    entities.contactTags.length > 0 ||
    entities.contactLists.length > 0;
  if (!hasUsefulEntities) return null;

  // Build prompt
  const userPrompt = await buildClassificationPrompt(
    sessionId, companyId, session.contact_id,
    classificationConfig.rules as string | undefined,
    entities,
  );

  // Call Claude Haiku
  const response = await anthropic.messages.create({
    model: CLASSIFICATION_MODEL,
    max_tokens: 1024,
    system: 'You are a conversation classifier for a customer messaging platform.\nAnalyze the conversation and classify it using ONLY the available options provided.\nApply the admin\'s classification rules when provided.\nReturn your best matches with confidence scores (0.0 to 1.0).\nIf nothing fits well (confidence < 0.3), omit that field rather than guessing.',
    messages: [{ role: 'user', content: userPrompt }],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_conversation' },
  });

  // Extract tool_use result
  const toolBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    console.error('Classification: no tool_use block in response');
    return null;
  }

  const suggestions = validateAndFilter(toolBlock.input as Record<string, unknown>, entities);

  // Check company classification mode
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('classification_mode')
    .eq('id', companyId)
    .single();

  const isAutoApply = company?.classification_mode === 'auto_apply';
  const finalStatus = isAutoApply ? 'applied' : 'pending';

  // Store suggestion
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('classification_suggestions')
    .insert({
      company_id: companyId,
      session_id: sessionId,
      contact_id: session.contact_id,
      trigger,
      status: finalStatus,
      suggestions,
      applied_at: isAutoApply ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (insertError) throw insertError;

  // Auto-apply if configured
  if (isAutoApply) {
    await applySuggestionItems(suggestions, sessionId, session.contact_id, companyId);
  }

  return inserted as ClassificationSuggestion;
}
```

- [ ] **Step 8: Add applySuggestion and dismissSuggestion exports**

```typescript
export async function acceptSuggestion(
  suggestionId: string,
  userId: string,
  companyId: string,
  partial?: PartialAccept,
): Promise<void> {
  const { data: suggestion, error } = await supabaseAdmin
    .from('classification_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('company_id', companyId)
    .single();

  if (error || !suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('CONFLICT');

  const suggestions = suggestion.suggestions as ClassificationSuggestions;

  // Re-validate entities still exist before applying (guard rail: entity deleted after classification)
  const entities = await fetchAvailableEntities(companyId);
  const validIds = new Set([
    ...entities.labels.map((l) => l.id),
    ...entities.priorities.map((p) => p.id),
    ...entities.statuses.map((s) => s.id),
    ...entities.contactTags.map((t) => t.id),
    ...entities.contactLists.map((l) => l.id),
  ]);

  // Filter out any suggestions referencing deleted entities
  const filtered: ClassificationSuggestions = {
    labels: suggestions.labels?.filter((l) => validIds.has(l.id)),
    priority: suggestions.priority && validIds.has(suggestions.priority.id) ? suggestions.priority : undefined,
    status: suggestions.status && validIds.has(suggestions.status.id) ? suggestions.status : undefined,
    contact_tags: suggestions.contact_tags?.filter((t) => validIds.has(t.id)),
    contact_lists: suggestions.contact_lists?.filter((l) => validIds.has(l.id)),
    reasoning: suggestions.reasoning,
  };

  await applySuggestionItems(
    filtered,
    suggestion.session_id,
    suggestion.contact_id,
    companyId,
    partial,
  );

  await supabaseAdmin
    .from('classification_suggestions')
    .update({
      status: 'accepted',
      applied_by: userId,
      applied_at: new Date().toISOString(),
      accepted_items: partial ? partial : null,
    })
    .eq('id', suggestionId);
}

export async function dismissSuggestion(
  suggestionId: string,
  companyId: string,
): Promise<void> {
  const { data: suggestion } = await supabaseAdmin
    .from('classification_suggestions')
    .select('status')
    .eq('id', suggestionId)
    .eq('company_id', companyId)
    .single();

  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('CONFLICT');

  await supabaseAdmin
    .from('classification_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId);
}
```

- [ ] **Step 9: Verify the file compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -10`
Expected: No errors in classification.ts

- [ ] **Step 10: Commit**

```bash
git add server/src/services/classification.ts
git commit -m "feat(classification): add core classification service with Haiku prompt and entity validation"
```

---

## Task 4: API Routes

**Files:**
- Create: `server/src/routes/classification.ts`
- Modify: `server/src/index.ts`

**Reference:** Follow the pattern in `server/src/routes/conversationPriorities.ts` — `Router()`, `requireAuth`, `requirePermission`, try/catch with `next(err)`.

- [ ] **Step 1: Create the classification router**

Create `server/src/routes/classification.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { classifyConversation, acceptSuggestion, dismissSuggestion } from '../services/classification.js';

const router = Router();
router.use(requireAuth);

// Rate limit tracking (in-memory, per session) with periodic cleanup
const classifyTimestamps = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of classifyTimestamps) {
    if (ts < cutoff) classifyTimestamps.delete(key);
  }
}, 60_000);

// POST /classify/:sessionId — trigger on-demand classification
router.post('/classify/:sessionId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const companyId = req.companyId!;

    // Rate limit: 1 per session per 30 seconds
    const lastClassified = classifyTimestamps.get(sessionId);
    if (lastClassified && Date.now() - lastClassified < 30_000) {
      res.status(429).json({ error: 'Classification already triggered recently. Try again in 30 seconds.' });
      return;
    }

    classifyTimestamps.set(sessionId, Date.now());

    const suggestion = await classifyConversation(sessionId, companyId, 'manual');

    if (!suggestion) {
      res.status(422).json({ error: 'Classification not available for this conversation. Check that the channel has an AI agent with classification enabled.' });
      return;
    }

    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
});

// GET /suggestions/:sessionId — fetch suggestions for a session
router.get('/suggestions/:sessionId', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('classification_suggestions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ suggestions: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /suggestions/:suggestionId/accept — accept all items
router.post('/suggestions/:suggestionId/accept', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const { suggestionId } = req.params;
    const companyId = req.companyId!;

    await acceptSuggestion(suggestionId, req.userId!, companyId);
    res.json({ status: 'ok' });
  } catch (err) {
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Suggestion is no longer pending' });
      return;
    }
    next(err);
  }
});

// POST /suggestions/:suggestionId/dismiss — dismiss suggestion
router.post('/suggestions/:suggestionId/dismiss', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const { suggestionId } = req.params;
    const companyId = req.companyId!;

    await dismissSuggestion(suggestionId, companyId);
    res.json({ status: 'ok' });
  } catch (err) {
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Suggestion is no longer pending' });
      return;
    }
    next(err);
  }
});

// POST /suggestions/:suggestionId/accept-partial — accept selected items
router.post('/suggestions/:suggestionId/accept-partial', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const { suggestionId } = req.params;
    const companyId = req.companyId!;
    const { accept } = req.body;

    if (!accept || typeof accept !== 'object') {
      res.status(400).json({ error: 'accept object is required' });
      return;
    }

    await acceptSuggestion(suggestionId, req.userId!, companyId, accept);
    res.json({ status: 'ok' });
  } catch (err) {
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Suggestion is no longer pending' });
      return;
    }
    next(err);
  }
});

// GET /settings — get company classification mode
router.get('/settings', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('classification_mode')
      .eq('id', companyId)
      .single();

    if (error) throw error;
    res.json({ classification_mode: data?.classification_mode || 'suggest' });
  } catch (err) {
    next(err);
  }
});

// PUT /settings — update classification mode
router.put('/settings', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { classification_mode } = req.body;

    if (!['auto_apply', 'suggest'].includes(classification_mode)) {
      res.status(400).json({ error: 'classification_mode must be "auto_apply" or "suggest"' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('companies')
      .update({ classification_mode, updated_at: new Date().toISOString() })
      .eq('id', companyId);

    if (error) throw error;
    res.json({ status: 'ok', classification_mode });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register the router in index.ts**

In `server/src/index.ts`, add the import (after line 38):

```typescript
import classificationRouter from './routes/classification.js';
```

And register the route (after line 130, before `app.use(errorHandler)`):

```typescript
app.use('/api/classification', classificationRouter);
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/classification.ts server/src/index.ts
git commit -m "feat(classification): add API routes and register router"
```

---

## Task 5: Auto-Classify Hook in Message Processor

**Files:**
- Modify: `server/src/services/messageProcessor.ts`

**Context:** The auto-classify hook goes after the outbound message early-return (line 595) and before the auto-reply evaluation (line 598). It fires only for new inbound sessions.

- [ ] **Step 1: Add the import**

At the top of `server/src/services/messageProcessor.ts`, add:

```typescript
import { classifyConversation } from './classification.js';
```

- [ ] **Step 2: Add the auto-classify call**

After line 595 (`if (isOutbound) return;`) and before the auto-reply block (line 597 `// 6a. Auto-reply`), insert:

```typescript
  // 5c. Auto-classify new conversations (fire-and-forget)
  if (isNewSession) {
    classifyConversation(sessionId, companyId, 'auto').catch((err) => {
      console.error('Auto-classification failed:', err);
    });
  }
```

This runs fire-and-forget — it doesn't block message processing or AI response generation.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --project server/tsconfig.json 2>&1 | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/services/messageProcessor.ts
git commit -m "feat(classification): add auto-classify hook for new inbound conversations"
```

---

## Task 6: Frontend Hook — useClassificationSuggestions

**Files:**
- Create: `client/src/hooks/useClassificationSuggestions.ts`

**Reference:** Follow the pattern in `client/src/hooks/useConversationPriorities.ts` — `useState`, `useCallback`, `useEffect`, return `{ data, loading, actions, refetch }`.

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

export interface SuggestionItem {
  id: string;
  confidence: number;
  name?: string;
}

export interface ClassificationSuggestions {
  labels?: SuggestionItem[];
  priority?: SuggestionItem;
  status?: SuggestionItem;
  contact_tags?: SuggestionItem[];
  contact_lists?: SuggestionItem[];
  reasoning: string;
}

export interface ClassificationSuggestion {
  id: string;
  session_id: string;
  contact_id: string;
  trigger: 'auto' | 'manual';
  status: 'pending' | 'accepted' | 'dismissed' | 'applied';
  suggestions: ClassificationSuggestions;
  accepted_items: Record<string, unknown> | null;
  created_at: string;
  applied_at: string | null;
}

export interface PartialAccept {
  labels?: string[];
  priority?: boolean;
  status?: boolean;
  contact_tags?: string[];
  contact_lists?: string[];
}

export function useClassificationSuggestions(sessionId: string | null) {
  const [suggestions, setSuggestions] = useState<ClassificationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    if (!sessionId) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/classification/suggestions/${sessionId}`);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Failed to fetch classification suggestions:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const classify = useCallback(async () => {
    if (!sessionId) return;
    setClassifying(true);
    try {
      await api.post(`/classification/classify/${sessionId}`);
      await fetchSuggestions();
    } finally {
      setClassifying(false);
    }
  }, [sessionId, fetchSuggestions]);

  const accept = useCallback(async (suggestionId: string) => {
    await api.post(`/classification/suggestions/${suggestionId}/accept`);
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'accepted' as const } : s))
    );
  }, []);

  const dismiss = useCallback(async (suggestionId: string) => {
    await api.post(`/classification/suggestions/${suggestionId}/dismiss`);
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'dismissed' as const } : s))
    );
  }, []);

  const acceptPartial = useCallback(async (suggestionId: string, partial: PartialAccept) => {
    await api.post(`/classification/suggestions/${suggestionId}/accept-partial`, { accept: partial });
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestionId ? { ...s, status: 'accepted' as const } : s))
    );
  }, []);

  return {
    suggestions,
    loading,
    classifying,
    classify,
    accept,
    dismiss,
    acceptPartial,
    refetch: fetchSuggestions,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useClassificationSuggestions.ts
git commit -m "feat(classification): add useClassificationSuggestions hook"
```

---

## Task 7: ClassificationCard Component (Side Panel)

**Files:**
- Create: `client/src/components/inbox/ClassificationCard.tsx`
- Modify: `client/src/components/inbox/ContactPanel.tsx`

**Reference:**
- `client/src/components/inbox/ContactPanel.tsx:22-31` — props shape
- Existing UI patterns: `Card`, `Badge`, `Button` from `@/components/ui/`

- [ ] **Step 1: Create the ClassificationCard component**

Create `client/src/components/inbox/ClassificationCard.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, X, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useClassificationSuggestions,
  type ClassificationSuggestion,
  type SuggestionItem,
} from '@/hooks/useClassificationSuggestions';

interface ClassificationCardProps {
  sessionId: string | null;
  onUpdate?: () => void;
}

function SuggestionItemBadge({
  item,
  onAccept,
  onDismiss,
}: {
  item: SuggestionItem;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant="secondary" className="text-xs" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
        {item.name || item.id}
        <span className="ml-1 text-muted-foreground">{Math.round(item.confidence * 100)}%</span>
      </Badge>
      {onAccept && (
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onAccept}>
          <Check className="h-3 w-3 text-green-600" />
        </Button>
      )}
      {onDismiss && (
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss}>
          <X className="h-3 w-3 text-red-500" />
        </Button>
      )}
    </div>
  );
}

function SuggestionRow({ label, items }: { label: string; items?: SuggestionItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <SuggestionItemBadge key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function PendingSuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  onUpdate,
}: {
  suggestion: ClassificationSuggestion;
  onAccept: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onUpdate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const s = suggestion.suggestions;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept(suggestion.id);
      toast.success('Classification applied');
      onUpdate?.();
    } catch {
      toast.error('Failed to apply classification');
    } finally {
      setAccepting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(suggestion.id);
    } catch {
      toast.error('Failed to dismiss');
    } finally {
      setDismissing(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <SuggestionRow label="Labels" items={s.labels} />
        {s.priority && <SuggestionRow label="Priority" items={[s.priority]} />}
        {s.status && <SuggestionRow label="Status" items={[s.status]} />}
        <SuggestionRow label="Contact Tags" items={s.contact_tags} />
        <SuggestionRow label="Contact Lists" items={s.contact_lists} />

        {s.reasoning && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Reasoning
            </button>
            {expanded && (
              <p className="mt-1 text-xs text-muted-foreground">{s.reasoning}</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleAccept} disabled={accepting || dismissing}>
            {accepting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Accept All
          </Button>
          <Button size="sm" variant="outline" onClick={handleDismiss} disabled={accepting || dismissing}>
            {dismissing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClassificationCard({ sessionId, onUpdate }: ClassificationCardProps) {
  const { suggestions, loading, classifying, classify, accept, dismiss } = useClassificationSuggestions(sessionId);

  const pending = suggestions.filter((s) => s.status === 'pending');
  const applied = suggestions.filter((s) => s.status === 'accepted' || s.status === 'applied');

  if (loading) return null;

  return (
    <div className="space-y-3">
      {/* Analyze button when no pending suggestions */}
      {pending.length === 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            classify().catch(() => toast.error('Classification failed'));
          }}
          disabled={classifying}
        >
          {classifying ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          {classifying ? 'Analyzing...' : 'Analyze Conversation'}
        </Button>
      )}

      {/* Pending suggestions */}
      {pending.map((s) => (
        <PendingSuggestionCard
          key={s.id}
          suggestion={s}
          onAccept={accept}
          onDismiss={dismiss}
          onUpdate={onUpdate}
        />
      ))}

      {/* Applied summary (most recent only) */}
      {pending.length === 0 && applied.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline h-3 w-3" />
          AI classified this conversation {new Date(applied[0].applied_at || applied[0].created_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount ClassificationCard in ContactPanel**

In `client/src/components/inbox/ContactPanel.tsx`, add the import at the top:

```typescript
import ClassificationCard from './ClassificationCard';
```

Then find the `Tabs` / `TabsContent` area inside the component and add the ClassificationCard. Look for the section after the contact info form or inside a tab. Add it before the notes section:

```tsx
<ClassificationCard sessionId={/* pass session ID from parent */} />
```

**Specific integration steps:**

1. Add `sessionId?: string | null;` to `ContactPanelProps` (line 22-31 of ContactPanel.tsx)
2. Accept it in the function signature: `export default function ContactPanel({ contactId, sessionId, open, ... })`
3. Inside the component, after the notes section (or at the end of the main content area), add:
   ```tsx
   {sessionId && <ClassificationCard sessionId={sessionId} />}
   ```
4. In `client/src/pages/InboxPage.tsx` (line 681), pass the session ID:
   ```tsx
   <ContactPanel
     contactId={activeConversation.contact_id}
     sessionId={activeConversation.id}
     open={contactPanelOpen}
     ...
   />
   ```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -10`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/inbox/ClassificationCard.tsx client/src/components/inbox/ContactPanel.tsx
git commit -m "feat(classification): add ClassificationCard component and mount in ContactPanel"
```

---

## Task 8: Analyze Button in ConversationHeader

**Files:**
- Modify: `client/src/components/inbox/ConversationHeader.tsx`

**Context:** The header has a row of icon buttons (Star, Archive, Pin, etc.). Add a Wand2 "Analyze" button to this row.

- [ ] **Step 1: Add the Wand2 import**

In the lucide-react import block (around line 22-40), add `Wand2` to the import list.

- [ ] **Step 2: Add the Analyze button**

Add the classify action to the props interface:

```typescript
onClassify?: () => void;
classifying?: boolean;
```

Then add the button in the action buttons area (look for the cluster of `TooltipProvider > Tooltip > Button` elements for Star, Archive, Pin, etc.). Add before the "More" dropdown:

```tsx
{onClassify && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClassify} disabled={classifying}>
          {classifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Analyze with AI</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

- [ ] **Step 3: Wire up from the parent**

The parent that renders `<ConversationHeader>` needs to pass `onClassify` and `classifying` props. This is likely in the inbox/conversation view page. Pass the `classify` function and `classifying` state from the `useClassificationSuggestions` hook.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -5`

- [ ] **Step 5: Commit**

```bash
git add client/src/components/inbox/ConversationHeader.tsx
git commit -m "feat(classification): add Analyze button to conversation header"
```

---

## Task 9: Agent Classification Settings

**Files:**
- Create: `client/src/components/agents/ClassificationSettings.tsx`
- Modify: `client/src/components/settings/AIAgentSections.tsx`

**Reference:** Follow the pattern of `StyleSection` / `LanguageSection` in the agent editor — receives `profileData` and `onSave` callback.

- [ ] **Step 1: Create ClassificationSettings component**

Create `client/src/components/agents/ClassificationSettings.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ProfileData } from '@/hooks/useCompanyAI';

interface ClassificationSettingsProps {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
}

export default function ClassificationSettings({ profileData, onSave }: ClassificationSettingsProps) {
  const config = (profileData as Record<string, unknown>).classification as
    | { enabled?: boolean; rules?: string; auto_classify_new?: boolean }
    | undefined;

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [autoClassifyNew, setAutoClassifyNew] = useState(config?.auto_classify_new ?? false);
  const [rules, setRules] = useState(config?.rules ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = {
        ...profileData,
        classification: { enabled, rules, auto_classify_new: autoClassifyNew },
      };
      await onSave({ profile_data: updated });
      toast.success('Classification settings saved');
    } catch {
      toast.error('Failed to save classification settings');
    } finally {
      setSaving(false);
    }
  }, [profileData, onSave, enabled, rules, autoClassifyNew]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI Classification
        </CardTitle>
        <CardDescription>
          Automatically classify conversations with labels, priority, status, and contact tags.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="classification-enabled">Enable classification</Label>
          <Switch
            id="classification-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-classify">Auto-classify new conversations</Label>
              <Switch
                id="auto-classify"
                checked={autoClassifyNew}
                onCheckedChange={setAutoClassifyNew}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="classification-rules">Classification rules</Label>
              <Textarea
                id="classification-rules"
                placeholder="e.g., If the customer mentions billing or payments, apply the 'Billing' label and set priority to High."
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Natural language instructions that guide the AI when classifying conversations.
              </p>
            </div>
          </>
        )}

        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount in AIAgentSections**

In `client/src/components/settings/AIAgentSections.tsx`, add the import:

```typescript
import ClassificationSettings from '../agents/ClassificationSettings';
```

Then add the section in the "Defaults" tab content (after `LanguageSection`):

```tsx
<ClassificationSettings profileData={profileData} onSave={onSave} />
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -5`

- [ ] **Step 4: Commit**

```bash
git add client/src/components/agents/ClassificationSettings.tsx client/src/components/settings/AIAgentSections.tsx
git commit -m "feat(classification): add classification settings in agent editor"
```

---

## Task 10: Company Classification Mode Setting

**Files:**
- Create: `client/src/components/settings/ClassificationModeSettings.tsx`
- Modify: `client/src/components/settings/ConversationSettingsTab.tsx`

**Reference:** Follow the pattern in `ConversationSettingsTab.tsx` — uses `api.get('/company')` to fetch settings, `api.put('/classification/settings')` to save.

- [ ] **Step 1: Create ClassificationModeSettings component**

Create `client/src/components/settings/ClassificationModeSettings.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ClassificationModeSettings() {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [mode, setMode] = useState<'auto_apply' | 'suggest'>('suggest');
  const [savedMode, setSavedMode] = useState<'auto_apply' | 'suggest'>('suggest');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchMode = useCallback(async () => {
    try {
      const { data } = await api.get('/classification/settings');
      setMode(data.classification_mode || 'suggest');
      setSavedMode(data.classification_mode || 'suggest');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/classification/settings', { classification_mode: mode });
      setSavedMode(mode);
      toast.success('Classification mode updated');
    } catch {
      toast.error('Failed to update classification mode');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI Classification Mode
        </CardTitle>
        <CardDescription>
          Choose how AI classification results are applied to conversations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'auto_apply' | 'suggest')} disabled={!canEdit}>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="suggest" id="mode-suggest" className="mt-1" />
            <div>
              <Label htmlFor="mode-suggest" className="font-medium">Suggest & Confirm</Label>
              <p className="text-sm text-muted-foreground">AI suggests labels, priority, and tags. A team member reviews and accepts or dismisses them.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="auto_apply" id="mode-auto" className="mt-1" />
            <div>
              <Label htmlFor="mode-auto" className="font-medium">Auto-Apply</Label>
              <p className="text-sm text-muted-foreground">AI automatically applies labels, priority, and tags without manual review. Existing non-default values are never overwritten.</p>
            </div>
          </div>
        </RadioGroup>

        {canEdit && mode !== savedMode && (
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount in ConversationSettingsTab**

In `client/src/components/settings/ConversationSettingsTab.tsx`, add the import:

```typescript
import ClassificationModeSettings from './ClassificationModeSettings';
```

Then add the component after the existing settings sections (e.g., after the auto-assign settings):

```tsx
<ClassificationModeSettings />
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -5`

- [ ] **Step 4: Commit**

```bash
git add client/src/components/settings/ClassificationModeSettings.tsx client/src/components/settings/ConversationSettingsTab.tsx
git commit -m "feat(classification): add classification mode settings in company settings"
```

---

## Task 11: Build Verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Both client and server build successfully with no errors.

- [ ] **Step 2: Fix any build errors**

If there are TypeScript or build errors, fix them now.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(classification): resolve build errors"
```

---

## Task 12: Manual Testing Checklist

Run `npm run dev` and verify the following manually:

- [ ] **Step 1: Database** — Verify migration applied: `classification_suggestions` table exists, `companies.classification_mode` column exists
- [ ] **Step 2: Settings** — Go to Company Settings → Conversations tab. Verify "AI Classification Mode" card appears with Suggest/Auto-Apply radio buttons
- [ ] **Step 3: Agent config** — Go to an AI Agent's settings. Verify "AI Classification" card appears with Enable toggle, Auto-classify toggle, and Rules textarea
- [ ] **Step 4: Analyze button** — Open a conversation. Verify the Wand2 "Analyze" button appears in the conversation header
- [ ] **Step 5: Classification card** — Open the contact panel. Verify the "Analyze Conversation" button appears
- [ ] **Step 6: On-demand classify** — Click Analyze on a conversation that has an AI agent with classification enabled. Verify suggestions appear
- [ ] **Step 7: Accept/Dismiss** — Accept a suggestion and verify labels/priority/status are applied. Dismiss another and verify it disappears
- [ ] **Step 8: Auto-classify** — Enable auto-classify on an agent, set mode to auto-apply. Send an inbound message to a new conversation. Verify labels/priority are auto-applied
