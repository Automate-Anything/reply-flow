# AI Auto-Classification Design Spec

## Overview

An AI-powered classification system that automatically analyzes conversations and applies metadata — labels, priority, status, contact tags, and contact list membership. Uses a single Claude Haiku API call with structured output, picking only from existing company entities. Supports two modes: auto-apply (immediate) and suggest-and-confirm (human reviews in side panel).

## Requirements

### Functional

1. **Auto-classify new conversations** — When a new inbound conversation starts, the channel's AI agent classifies it automatically (if classification is enabled on the agent).
2. **On-demand classification** — Team members can trigger classification on any existing conversation via an "Analyze" button.
3. **Classification outputs:**
   - Labels on the conversation (from existing `labels`)
   - Priority on the conversation (from existing `conversation_priorities`)
   - Status on the conversation (from existing `conversation_statuses`)
   - Tags on the contact (from existing contact tags)
   - Contact list membership (from existing `contact_lists`)
4. **Admin-configurable rules** — Natural language classification instructions stored in the AI agent's `profile_data`.
5. **Company-level apply mode** — Configurable per company: "auto_apply" (immediate) or "suggest" (human confirms).
6. **Suggest & confirm UI** — Pending suggestions appear in the conversation side panel with per-item accept/dismiss and bulk accept/dismiss.
7. **No override rule** — Auto-apply only sets priority/status when the current value is the company's default (checked via `is_default` flag on the priority/status row). If a non-default value is already set (whether by a human or previous classification), auto-apply skips those fields.
8. **Context used** — Contact history (last 3-5 past sessions) + full current session messages.
9. **Only existing entities** — The AI never creates new labels/tags/lists; it picks from what exists in the company.

### Non-Functional

- Classification latency: < 3 seconds (Haiku is typically < 2s)
- Token budget: ~3000-8000 input tokens + ~500-1000 output tokens per classification
- Rate limit: 1 on-demand classification per session per 30 seconds
- Confidence threshold: items below 0.3 confidence are omitted
- Max 5 labels per classification

## Data Model

### New Table: `classification_suggestions`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PK, default gen_random_uuid() | |
| `company_id` | UUID | FK → companies, NOT NULL | Multi-tenant isolation |
| `session_id` | UUID | FK → chat_sessions, NOT NULL | Conversation being classified |
| `contact_id` | UUID | FK → contacts, NOT NULL | Contact being tagged |
| `trigger` | TEXT | CHECK ('auto', 'manual'), NOT NULL | How classification was initiated |
| `status` | TEXT | CHECK ('pending', 'accepted', 'dismissed', 'applied'), NOT NULL, default 'pending' | Suggestion lifecycle |
| `suggestions` | JSONB | NOT NULL | Full AI output (see schema below) |
| `accepted_items` | JSONB | nullable | Tracks which items were accepted in partial accept (for analytics) |
| `applied_by` | UUID | FK → auth.users, nullable | Who accepted (null if auto-applied) |
| `created_at` | TIMESTAMPTZ | default now() | |
| `applied_at` | TIMESTAMPTZ | nullable | When accepted/applied |
| `updated_at` | TIMESTAMPTZ | default now(), trigger auto-update | Standard audit column |

**Indexes:**
- `idx_classification_suggestions_session` on `(session_id)` WHERE `status = 'pending'`
- `idx_classification_suggestions_company` on `(company_id)`

**RLS Policies:**
- SELECT/INSERT/UPDATE: `company_id = get_user_company_id()` (function calls `auth.uid()` internally)

### `suggestions` JSONB Schema

```json
{
  "labels": [{ "id": "uuid", "name": "Billing", "confidence": 0.95 }],
  "priority": { "id": "uuid", "name": "High", "confidence": 0.88 },
  "status": { "id": "uuid", "name": "pending", "confidence": 0.92 },
  "contact_tags": [{ "id": "uuid", "name": "VIP", "confidence": 0.90 }, { "id": "uuid", "name": "Returning Customer", "confidence": 0.85 }],
  "contact_lists": [{ "id": "uuid", "name": "Hot Leads", "confidence": 0.85 }],
  "reasoning": "Customer is asking about a refund for order #1234, expressing urgency..."
}
```

### Modified Tables

**`companies`** — new column:

| Column | Type | Default |
|--------|------|---------|
| `classification_mode` | TEXT | 'suggest' |

CHECK constraint: `classification_mode IN ('auto_apply', 'suggest')`

**`ai_agents.profile_data`** — new key in existing JSONB:

```json
{
  "classification": {
    "enabled": true,
    "rules": "If the customer mentions billing or payments, apply 'Billing' label...",
    "auto_classify_new": true
  }
}
```

No schema migration needed for this — it's a JSONB field.

## API Routes

### New Router: `/api/classification`

Registered in `server/src/index.ts`. All routes require `requireAuth` middleware.

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/classify/:sessionId` | POST | `conversations.edit` | Trigger on-demand classification |
| `/suggestions/:sessionId` | GET | `conversations.view` | Fetch pending suggestions for a session |
| `/suggestions/:suggestionId/accept` | POST | `conversations.edit` | Accept all items in a suggestion |
| `/suggestions/:suggestionId/dismiss` | POST | `conversations.edit` | Dismiss a suggestion |
| `/suggestions/:suggestionId/accept-partial` | POST | `conversations.edit` | Accept selected items from a suggestion |
| `/settings` | GET | `company_settings.view` | Get company classification mode |
| `/settings` | PUT | `company_settings.edit` | Update classification mode |

### POST `/classify/:sessionId`

**Request:** empty body (session ID in URL)

**Response:**
```json
{
  "suggestion": {
    "id": "uuid",
    "status": "pending" | "applied",
    "suggestions": { /* JSONB */ }
  }
}
```

Returns `applied` status in auto_apply mode, `pending` in suggest mode.

### POST `/suggestions/:suggestionId/accept-partial`

**Request:**
```json
{
  "accept": {
    "labels": ["uuid1", "uuid2"],
    "priority": true,
    "status": false,
    "contact_tags": ["tag-uuid1"],
    "contact_lists": ["uuid3"]
  }
}
```

Only the selected items are applied; the rest are discarded.

## Service Layer

### New Service: `server/src/services/classification.ts`

#### `classifyConversation(sessionId: string, companyId: string, trigger: 'auto' | 'manual'): Promise<ClassificationSuggestion>`

1. Fetch the session → get `channel_id` and `contact_id`
2. Fetch channel's AI agent via `channel_agent_settings` → get `agent_id` → get `ai_agents.profile_data.classification`
3. If classification not enabled, throw or return null
4. Gather context:
   - Current session messages from `chat_messages` (all, capped at 50 most recent)
   - Contact info from `contacts` (name, phone, email, tags, custom fields)
   - Contact history: last 3-5 past `chat_sessions` for this contact (last_message, status, labels)
5. Fetch available entities for this company:
   - `labels` (visible to company)
   - `conversation_priorities` (active)
   - `conversation_statuses` (active)
   - `contact_tags` table (id, name, color — proper tag entities, not free-form strings)
   - `contact_lists` (active)
6. Build prompt and call Claude Haiku with tool_use (structured output)
7. Validate response: check all returned IDs exist in the company's entities
8. Filter by confidence threshold (>= 0.3)
9. Cap labels at 5
10. Store in `classification_suggestions` table
11. If company `classification_mode` is `auto_apply`:
    - Apply labels → insert into `conversation_labels`
    - Apply priority → update `chat_sessions.priority` (only if current is default/empty)
    - Apply status → update `chat_sessions.status` (only if current is default)
    - Apply contact tags → merge into `contacts.tags` array
    - Apply contact lists → insert into contact list membership
    - Set suggestion status to `'applied'`
12. Return the suggestion record

#### `applySuggestion(suggestionId: string, userId: string, partial?: PartialAccept): Promise<void>`

Applies a pending suggestion (or partial subset). Updates the conversation, contact, and sets suggestion status to `'accepted'`.

#### `dismissSuggestion(suggestionId: string, userId: string): Promise<void>`

Sets suggestion status to `'dismissed'`.

## AI Prompt Design

### Model

`claude-haiku-4-5-20251001` (same model used for classification elsewhere in the project)

### System Prompt

```
You are a conversation classifier for a customer messaging platform.
Analyze the conversation and classify it using ONLY the available options provided.
Apply the admin's classification rules when provided.
Return your best matches with confidence scores (0.0 to 1.0).
If nothing fits well (confidence < 0.3), omit that field rather than guessing.
```

### User Message Structure

```
## Admin Classification Rules
{rules from profile_data.classification.rules, or "No specific rules configured."}

## Contact Information
Name: {name}
Phone: {phone}
Email: {email}
Existing Tags: {tags}
Current Lists: {lists}

## Contact History (Last {N} Conversations)
{For each past session: date, status, labels, last message snippet}

## Current Conversation
{Messages in chronological order: sender, timestamp, body}

## Available Classification Options

Labels: {JSON array of {id, name}}
Priorities: {JSON array of {id, name}}
Statuses: {JSON array of {id, name, group}}
Contact Tags: {JSON array of {id, name}}
Contact Lists: {JSON array of {id, name}}
```

### Tool Definition

```json
{
  "name": "classify_conversation",
  "description": "Classify the conversation based on its content and context",
  "input_schema": {
    "type": "object",
    "properties": {
      "labels": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["id", "confidence"]
        }
      },
      "priority": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["id", "confidence"]
      },
      "status": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["id", "confidence"]
      },
      "contact_tags": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["id", "confidence"]
        }
      },
      "contact_lists": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
          },
          "required": ["id", "confidence"]
        }
      },
      "reasoning": { "type": "string" }
    },
    "required": ["reasoning"]
  }
}
```

## Frontend

### New Components

#### `ClassificationCard.tsx`

Location: `client/src/components/inbox/ClassificationCard.tsx`

Mounted in the conversation detail side panel. States:

1. **Empty** — No suggestions, no card shown (unless "Analyze" button is in this area)
2. **Loading** — Spinner while classification API call is in progress
3. **Pending suggestions** — Card with:
   - Header: "AI Suggestions" with sparkle icon
   - Collapsible reasoning text (muted)
   - Per-category rows: Labels (chips), Priority (badge), Status (badge), Contact Tags (chips), Contact Lists (chips)
   - Each item has individual accept (checkmark) / dismiss (X) controls
   - Confidence shown as subtle opacity or small percentage
   - Footer: "Accept All" and "Dismiss All" buttons
4. **Applied** — Compact note: "AI classified this conversation" with timestamp, expandable to see what was applied

#### `ClassificationSettings.tsx`

Location: `client/src/components/agents/ClassificationSettings.tsx`

Section in the agent editor form:
- Toggle: "Enable classification"
- Toggle: "Auto-classify new conversations" (only visible when enabled)
- Textarea: "Classification rules" — natural language instructions

#### `ClassificationModeSettings.tsx`

Location: `client/src/components/settings/ClassificationModeSettings.tsx`

Section in company settings:
- Radio/select: "Auto-apply" vs "Suggest & confirm"
- Description text explaining each mode

### Modified Components

| Component | Change |
|-----------|--------|
| Conversation detail side panel | Mount `<ClassificationCard>` |
| Conversation header bar | Add "Analyze" button (wand icon) |
| Agent editor | Mount `<ClassificationSettings>` section |
| Company settings page | Mount `<ClassificationModeSettings>` section |

### New Hook: `useClassificationSuggestions`

Location: `client/src/hooks/useClassificationSuggestions.ts`

```typescript
export function useClassificationSuggestions(sessionId: string) {
  // Returns:
  // - suggestions: ClassificationSuggestion[] (pending suggestions for this session)
  // - loading: boolean
  // - classify: () => Promise<void> (trigger on-demand classification)
  // - accept: (suggestionId: string) => Promise<void>
  // - dismiss: (suggestionId: string) => Promise<void>
  // - acceptPartial: (suggestionId: string, partial: PartialAccept) => Promise<void>
  // - refetch: () => void
}
```

### Realtime Behavior

- **Auto-apply mode**: Conversation metadata (labels, priority, status) updates in DB. Existing inbox list refetch behavior picks up changes naturally.
- **Suggest mode**: Side panel fetches suggestions when session changes. After on-demand classify call, refetch suggestions automatically.

## Integration Point: Auto-Classify on New Conversation

In the existing inbound message handler (in `server/src/routes/ai.ts` or the webhook handler), after the first inbound message is stored in a new `chat_session` (not on session creation itself, since the session may not have messages yet):

```typescript
// Fire-and-forget — don't block message delivery
const agentSettings = await getChannelAgentSettings(channelId);
const agent = agentSettings?.agent_id ? await getAgent(agentSettings.agent_id) : null;

if (agent?.profile_data?.classification?.enabled && agent.profile_data.classification.auto_classify_new) {
  classifyConversation(session.id, companyId, 'auto').catch(err => {
    console.error('Auto-classification failed:', err);
  });
}
```

## Guard Rails

| Rule | Implementation |
|------|---------------|
| Confidence threshold | Items below 0.3 confidence are omitted from suggestions |
| No hallucinated IDs | Server validates every returned ID exists in company before applying |
| Max labels | Cap at 5 labels per classification |
| Rate limit | On-demand: 1 per session per 30 seconds (429 if exceeded) |
| No override | Auto-apply skips priority/status when current value is non-default (checked via `is_default` flag on the referenced status/priority row) |
| Async execution | Auto-classify on new conversation is fire-and-forget, doesn't block message delivery |
| Error isolation | Classification failures are logged but never break the message flow |
| Deduplication | Before auto-classifying, check no `classification_suggestions` row exists for this `session_id` with `status IN ('pending', 'applied')` created in the last 60 seconds. Prevents double-classification from duplicate webhooks |
| Entity validation on accept | When accepting a suggestion, re-validate that all referenced entities still exist (a label may have been deleted since classification) |
| Empty entity guard | If the company has zero labels AND zero non-default tags AND zero contact lists, skip classification (nothing useful to pick from) |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Conversation with no messages yet | Defer auto-classification until first inbound message is stored (trigger after message insert, not session creation) |
| First-time contact, single short message | Attempt classification anyway — the AI may still infer priority or match labels from a short message. Confidence scores will naturally be lower. |
| Company with no labels/tags/lists configured | Skip classification entirely (see empty entity guard above). No suggestion is created. |
| Concurrent suggestion acceptance | Second accept call returns 409 Conflict if suggestion status is no longer `pending` |
| Entity deleted after classification | Accept endpoint re-validates entity existence; skips deleted entities and applies the rest. If all entities are gone, returns error. |
| Very large entity lists (200+ labels) | Cap the prompt to the 50 most recently used labels + all labels matching the admin's rules. Include a note in the prompt that only a subset is shown. |
| Partial accept tracking | When `accept-partial` is used, store an `accepted_items` JSONB alongside `suggestions` to track which items were accepted vs dismissed (useful for analytics). |

## Permissions

| Action | Required Permission |
|--------|-------------------|
| Trigger on-demand classification | `conversations.edit` |
| View suggestions | `conversations.view` |
| Accept/dismiss suggestions | `conversations.edit` |
| View classification settings | `company_settings.view` |
| Change classification mode | `company_settings.edit` |
| Configure agent classification rules | `ai_settings.edit` |

## Migration

File: `supabase/migrations/065_ai_classification.sql`

Creates:
- `classification_suggestions` table with all columns, constraints, and indexes
- `classification_mode` column on `companies` table (TEXT, default 'suggest')
- RLS policies on `classification_suggestions`

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/065_ai_classification.sql` | DB migration |
| `server/src/routes/classification.ts` | API routes |
| `server/src/services/classification.ts` | Classification logic, prompt building, entity resolution |
| `client/src/hooks/useClassificationSuggestions.ts` | Data-fetching hook |
| `client/src/components/inbox/ClassificationCard.tsx` | Side panel suggestions UI |
| `client/src/components/agents/ClassificationSettings.tsx` | Agent classification config |
| `client/src/components/settings/ClassificationModeSettings.tsx` | Company mode setting |

### Modified Files

| File | Change |
|------|--------|
| `server/src/index.ts` | Register classification router |
| `server/src/routes/ai.ts` | Add auto-classify hook on new session creation |
| `server/src/types/index.ts` | Add TypeScript interfaces |
| Conversation detail side panel component | Mount ClassificationCard |
| Conversation header component | Add Analyze button |
| Agent editor component | Mount ClassificationSettings |
| Settings page | Mount ClassificationModeSettings |
