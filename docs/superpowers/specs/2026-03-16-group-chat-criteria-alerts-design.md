# Group Chat Criteria Alerts — Design Spec

**Date:** 2026-03-16
**Status:** Draft

## Overview

Add the ability for customers to monitor their WhatsApp group chats and receive in-app notifications when messages match configurable criteria. Groups are **read-only** — the system never sends messages to groups. The AI agent evaluates incoming group messages and alerts team members when criteria are met.

## Key Concepts

- **Group Chat**: A real WhatsApp group (`@g.us`) connected through an existing Whapi channel. Auto-discovered when the webhook receives a group message, but not monitored until the customer explicitly enables it.
- **Criteria**: A configurable rule that defines what to look for in group messages. Two match types:
  - **Keyword**: Simple keyword/phrase matching (case-insensitive, AND/OR logic)
  - **AI**: Natural language description evaluated by Claude (e.g., "Someone is complaining about delivery delays")
- **Criteria Scope**: Criteria can be either:
  - **Group-specific**: Applies only to a single group
  - **Global**: Applies across all monitored groups
- **Notification**: When a message matches one or more criteria, a single consolidated notification is sent to the union of all team members configured across the matched criteria.

## Constraints

- **No outbound messages to groups.** The system only reads, evaluates, and notifies. The AI agent must never respond in a group chat.
- **Existing notification system.** Uses the current `notifications` table and `notificationService.ts`. New notification type added, no new delivery channels (in-app only for now).
- **Multi-tenant isolation.** All tables scoped by `company_id` with RLS policies, consistent with the rest of the system.

## Data Model

### New Tables

#### `group_chats`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `company_id` | UUID (FK → companies) | Tenant isolation |
| `channel_id` | UUID (FK → whatsapp_channels) | Which channel this group is on |
| `group_jid` | TEXT | WhatsApp group JID (ends in `@g.us`) |
| `group_name` | TEXT | Group name from WhatsApp metadata |
| `monitoring_enabled` | BOOLEAN | Whether criteria evaluation is active (default: `false`) |
| `created_at` | TIMESTAMPTZ | When the group was first discovered |
| `updated_at` | TIMESTAMPTZ | Last metadata update |

- **Unique constraint:** `(channel_id, group_jid)`
- **RLS:** Filtered by `company_id`

#### `group_chat_messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `company_id` | UUID (FK → companies) | Tenant isolation |
| `group_chat_id` | UUID (FK → group_chats) | Which group this message belongs to |
| `whatsapp_message_id` | TEXT | WhatsApp message ID for deduplication |
| `sender_phone` | TEXT | Phone number of the sender in the group |
| `sender_name` | TEXT | Sender's display name (if available from WhatsApp) |
| `message_body` | TEXT | Message text content |
| `message_type` | TEXT | Type (text, image, video, etc.) |
| `metadata` | JSONB | Additional message data (media URLs, etc.) |
| `created_at` | TIMESTAMPTZ | When the message was received |

- **Unique constraint:** `(group_chat_id, whatsapp_message_id)`
- **RLS:** Filtered by `company_id`
- **Realtime:** Published to Supabase Realtime for live UI updates

#### `group_criteria`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `company_id` | UUID (FK → companies) | Tenant isolation |
| `group_chat_id` | UUID (FK → group_chats, nullable) | If set: group-specific. If `NULL`: global criteria |
| `name` | TEXT | Human-readable label (e.g., "Urgent complaints") |
| `match_type` | TEXT | `keyword` or `ai` |
| `keyword_config` | JSONB | For keyword type: `{ "keywords": ["urgent", "help"], "operator": "or" }` |
| `ai_description` | TEXT | For AI type: natural language description of what to detect |
| `notify_user_ids` | UUID[] | Array of team member IDs to notify on match |
| `is_enabled` | BOOLEAN | Toggle criteria on/off (default: `true`) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

- **RLS:** Filtered by `company_id`

#### `group_criteria_matches`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `company_id` | UUID (FK → companies) | Tenant isolation |
| `group_chat_message_id` | UUID (FK → group_chat_messages) | The message that triggered the match |
| `criteria_ids` | UUID[] | All criteria that matched this message |
| `notification_id` | UUID (FK → notifications, nullable) | The consolidated notification created |
| `created_at` | TIMESTAMPTZ | |

- **RLS:** Filtered by `company_id`

## Message Ingestion & Processing

### Webhook Changes

Current behavior in `webhook.ts`: messages with `chat_id` ending in `@g.us` are skipped. New behavior:

1. Receive group message from Whapi webhook
2. Look up `group_chats` by `(channel_id, group_jid)`
3. **Group not found:** Auto-create row with `monitoring_enabled = false`. Stop processing. (Group now appears as available to configure in the UI.)
4. **Group found, monitoring disabled:** Stop processing.
5. **Group found, monitoring enabled:** Store message in `group_chat_messages`, then pass to criteria evaluation pipeline.

### Criteria Evaluation Pipeline

New service: `server/src/services/groupCriteriaService.ts`

Triggered when a monitored group message is stored:

1. **Fetch applicable criteria:** All enabled criteria where `group_chat_id` matches this group OR `group_chat_id IS NULL` (global)
2. **Evaluate keyword criteria locally:**
   - Case-insensitive substring matching
   - AND operator: all keywords must appear in the message
   - OR operator: any keyword must appear
   - Returns list of matched keyword criteria
3. **Evaluate AI criteria via Claude:**
   - Batch all AI criteria into a single API call
   - Prompt asks Claude to evaluate the message against each criteria description and return which ones matched (with a yes/no per criteria)
   - Returns list of matched AI criteria
4. **Consolidate matches:**
   - Union all matched criteria (keyword + AI)
   - If no matches, stop here
5. **Create notification:**
   - Collect the union of all `notify_user_ids` across matched criteria
   - Create one `notifications` row per recipient with type `group_criteria_match`
   - Notification `metadata` includes: group name, group chat ID, message body, sender phone/name, list of matched criteria (names + IDs), `group_chat_message_id`
6. **Log match:** Insert row into `group_criteria_matches` linking the message, criteria IDs, and notification

### Important: No Outbound Messages

The pipeline must **never** call Whapi's send message API. No code path from group message ingestion should lead to sending a response. This is enforced architecturally by keeping the group processing pipeline completely separate from the 1-to-1 `messageProcessor.ts` flow.

## Notification Integration

- **New notification type:** `group_criteria_match` added to the existing notification types enum/check constraint
- **Uses existing infrastructure:** `notificationService.ts`, `notifications` table, Supabase Realtime CDC for live delivery to the frontend
- **Respects notification preferences:** If a team member has notifications disabled, they don't receive group criteria alerts either
- **Consolidated:** One notification per message per recipient, listing all matched criteria in the metadata
- **Click behavior:** Navigates to the Groups page, focused on the matched group, highlighting or scrolling to the specific message

## Frontend

### New Page: `/groups`

Added to the main sidebar navigation.

#### Tab 1: Groups

- Lists all discovered WhatsApp groups for the company's channels
- Each group row shows: group name, channel name, monitoring toggle (on/off), count of active criteria
- Clicking a group opens a detail view:
  - **Monitoring toggle** — enable/disable message ingestion and criteria evaluation
  - **Group-specific criteria list** — add, edit, delete criteria scoped to this group
  - **Matched messages feed** — messages that triggered criteria matches, showing: message body, sender phone/name, timestamp, which criteria matched

#### Tab 2: Global Criteria

- Lists all global criteria (where `group_chat_id IS NULL`)
- Same add/edit/delete interface as group-specific criteria
- Each criteria card shows: name, match type badge (Keyword / AI), condition summary, notification recipients, enabled/disabled toggle

#### Criteria Editor (shared dialog)

Used for both group-specific and global criteria:

- **Name** — text input
- **Match type** — selector: Keyword or AI
- **If Keyword:**
  - Keywords/phrases input (comma-separated or tag-style)
  - Logic toggle: AND / OR
- **If AI:**
  - Textarea for natural language description
- **Notify** — multi-select of team members
- **Enabled** — toggle

### Notification Click Navigation

When a user clicks a `group_criteria_match` notification:
1. Navigate to `/groups`
2. Open the detail view for the matched group
3. Scroll to / highlight the matched message
4. Show a badge or indicator of which criteria triggered

### Realtime Updates

- Subscribe to `group_chat_messages` (INSERT) for live message feed in the group detail view
- Subscribe to `group_criteria_matches` (INSERT) to highlight new matches in real-time
- Existing `notifications` subscription handles the notification bell/badge

## API Routes

### New route file: `server/src/routes/groups.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/groups` | List all group chats for the company |
| `PATCH` | `/groups/:id` | Update group (toggle monitoring, update name) |
| `GET` | `/groups/:id/messages` | Get messages for a group (paginated, with optional filter for matched-only) |
| `GET` | `/groups/:id/criteria` | List criteria for a specific group |
| `POST` | `/groups/criteria` | Create a new criteria (group-specific or global based on `group_chat_id` field) |
| `PATCH` | `/groups/criteria/:id` | Update a criteria |
| `DELETE` | `/groups/criteria/:id` | Delete a criteria |
| `GET` | `/groups/criteria/global` | List all global criteria |
| `GET` | `/groups/:id/matches` | Get criteria match log for a group |

## Out of Scope (Future)

- External notification channels (email, webhook, Slack)
- Responding to group messages
- Group member management / metadata editing
- Media message content analysis (only text evaluated for now)
- Criteria templates / presets
- Analytics / dashboards on match frequency
