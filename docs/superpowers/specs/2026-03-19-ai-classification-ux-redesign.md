# AI Classification UX Redesign

> Replaces: `2026-03-17-ai-auto-classification-design.md` (original design had poor UX — buried suggestions, split config, no discoverability)

## Problem

The current AI classification feature works technically but has terrible UX:
- Suggestions are buried in the Info tab of a slide-over contact panel
- Configuration is split across AI Agent settings and Conversation settings
- No visual feedback when classification runs or completes
- The wand icon has no context — users don't know what it does
- No history of past classifications
- Classification is incorrectly tied to AI agents instead of channels

## Design Principles

1. **Classification is a channel feature**, not an AI agent feature
2. **One place for everything** — the AI tab in the side panel is the classification hub
3. **Config follows the hierarchy** — company defaults → channel overrides
4. **Cross-link everything** — users should always be able to navigate between config pages and the classification UI
5. **Notifications handle awareness** — users don't need to check manually

---

## 1. Side Panel — AI Tab

The ContactPanel gains a third tab: **Info | Notes | AI**

### Layout (top to bottom)

#### 1.1 Analyze Button
- Full-width button at the top: "Analyze Conversation" with Sparkles icon
- While running: spinner + "Analyzing..."
- Disabled while analyzing

#### 1.2 Pending Suggestions Card
Only visible when pending suggestions exist. This is a full redesign of the existing `ClassificationCard.tsx` — the old card is removed and replaced by this new UI inside `ClassificationTab.tsx`.

- **Grouped by category**: Labels, Priority, Status, Contact Tags, Contact Lists
- Each item: name + confidence badge (e.g., "Test label 1 · 95%") with a **checkbox** (checked by default) — user can uncheck items before accepting (partial accept via existing `accept-partial` endpoint)
- Expandable "Reasoning" section
- Two action buttons: **Accept All** (applies only checked items) | **Dismiss**

#### 1.3 Classification History
Scrollable list of all past classifications for this conversation.

Each entry shows:
- Trigger type icon (auto ⚡ / manual 🪄)
- Timestamp
- What was suggested (categories + items)
- Outcome: accepted / dismissed / applied (auto-apply)
- Who accepted (if manual)

Most recent first. Frontend shows last 3 by default, "Show all" expands to show the rest. All suggestions are fetched in one API call (the existing `GET /suggestions/:sessionId` endpoint) — pagination is not needed since classification frequency is naturally low (at most one per conversation per session boundary).

#### 1.4 Disabled / Empty States

- **Classification disabled** (company master switch off, or channel set to "Disabled"): AI tab shows a message: "Classification is not enabled. [Enable in settings →]" with a link to the appropriate settings page.
- **Classification enabled but no entities** (no labels, priorities, statuses, tags, or lists configured): "No classification options available. Add labels, priorities, or tags in settings to get started."
- **Classification enabled, entities exist, no suggestions yet**: Shows the Analyze button and empty history.

#### 1.5 Settings Links
Small text links at bottom:
- "Company classification settings →"
- "Channel classification settings →" (links to the specific channel for this conversation — the `channel_id` is fetched from the session data, which is already available via the suggestions API or a lightweight session lookup)

### Wand Button Behavior

- **Click**: Opens side panel directly to the AI tab (does NOT auto-trigger classification)
- **Badge dot**: Appears on the wand icon when there are pending suggestions for the current conversation
- **Clicking contact name**: Still opens side panel to Info tab (existing behavior unchanged)

---

## 2. Configuration — Company Level

New **"AI Classification"** card in Company Settings (Conversations settings page or a dedicated subsection).

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Enable AI Classification | Toggle | Off | Master switch. When off, no classification anywhere. Reveals remaining fields when on. |
| Default mode | Select | "Suggest & Confirm" | Options: "Suggest & Confirm", "Auto-Apply" |
| Auto-classify new conversations | Toggle | Off | When on, every new inbound conversation is automatically analyzed |
| Classification rules | Textarea | Empty | Natural language instructions. Label: "These rules apply to all channels unless overridden." |

### Navigation
- Link at bottom: "You can override these settings per channel. [Manage channel settings →]"

---

## 3. Configuration — Channel Level

New **"AI Classification"** card in each channel's settings page.

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Classification for this channel | Three-way select | "Use company defaults" | Options: "Use company defaults" / "Custom settings" / "Disabled" |

When "Custom settings" is selected, additional fields appear:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | (inherits) | "Suggest & Confirm" / "Auto-Apply" |
| Auto-classify new conversations | Toggle | (inherits) | Override company default |
| Channel-specific rules | Textarea | Empty | Label: "These rules are used *in addition to* company-level rules." |

### Key Behavior
- **"Use company defaults"**: Inherits all company-level settings. No overrides.
- **"Custom settings"**: Channel values override company values for mode and auto-classify. Rules are **additive** — company rules + channel rules both apply.
- **"Disabled"**: Classification is off for this channel regardless of company settings.

### Navigation
- Link: "Company-level classification settings →"

---

## 4. Notifications & Feedback

### Manual Classification (user clicks Analyze)
- **While running**: Spinner on Analyze button
- **Success**: Suggestions appear in AI tab + toast: "Analysis complete — X suggestions"
- **Failure**: Toast error: "Classification failed. Try again."

### Auto-Apply Mode (classification applied automatically)
- **In-app notification**: "AI classified [contact name]: added Label X, set priority Y"
- Configurable in notification settings (default: on)
- AI tab history updates silently

### Suggest Mode + Auto-Trigger (suggestions waiting for review)
- **In-app notification**: "AI has suggestions for [contact name]" — clicking opens the conversation with AI tab focused
- **Wand badge dot** appears on that conversation's header
- Configurable in notification settings (default: on)

### User Accepts Suggestions
- **Toast**: "Classification applied"
- **History entry**: Updated to "Accepted" with timestamp and who accepted

### User Dismisses Suggestions
- **Toast**: "Suggestions dismissed"
- **History entry**: Updated to "Dismissed" with timestamp

---

## 5. Database Changes

### New columns on `companies`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| classification_enabled | BOOLEAN | false | Master enable/disable |
| classification_rules | TEXT | NULL | Company-level natural language rules |
| classification_auto_classify | BOOLEAN | false | Auto-classify new conversations |

> `classification_mode` already exists (TEXT, default 'suggest').

### New columns on `channel_agent_settings`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| classification_override | TEXT | 'company_defaults' | 'company_defaults' / 'custom' / 'disabled' |
| classification_mode | TEXT | NULL | Override mode (NULL = use company default) |
| classification_auto_classify | BOOLEAN | NULL | Override auto-classify (NULL = use company default) |
| classification_rules | TEXT | NULL | Channel-specific rules (additive to company rules) |

### Removed
- Classification config from `ai_agents.profile_data.classification` — no longer used

### Notification type constraint
The `notifications` table has a CHECK constraint on the `type` column. The migration must add `'classification'` to the allowed values:

```sql
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  -- existing types:
  'assignment', 'share',
  'message_assigned', 'message_accessible',
  'snooze_set', 'schedule_set', 'schedule_sent',
  'status_change', 'contact_note',
  'handoff', 'group_criteria_match',
  -- new:
  'classification'
));
```

Also update `notification_preferences` default JSONB to include `"classification": true`.

### Unchanged
- `classification_suggestions` table — no schema changes
- `companies.classification_mode` — already exists

---

## 6. Backend Changes

### API Endpoints

Expand the existing classification routes to cover config management:

**Company-level config:**
- `GET /api/classification/company-settings` — returns all company classification fields (`classification_enabled`, `classification_mode`, `classification_auto_classify`, `classification_rules`)
- `PUT /api/classification/company-settings` — updates company classification fields. Requires `company_settings:edit` permission.

**Channel-level config:**
- `GET /api/classification/channel-settings/:channelId` — returns channel classification override fields
- `PUT /api/classification/channel-settings/:channelId` — updates channel classification fields. Requires `channel_settings:edit` permission.

**Classification status for AI tab:**
- `GET /api/classification/status/:sessionId` — returns resolved config for this session's channel (is classification enabled? what mode? are there pending suggestions?). Used by the AI tab to decide what to render (analyze button, disabled message, etc.). Also returns the `channel_id` so the frontend can build the channel settings link.

The existing endpoints (`POST /classify/:sessionId`, `GET /suggestions/:sessionId`, `POST /suggestions/:id/accept`, etc.) remain unchanged.

### Config Resolution
The `classifyConversation` service changes how it reads config:

1. Check `companies.classification_enabled` — if `false`, return null (master switch off)
2. Read `channel_agent_settings` row for this channel → check `classification_override`
3. If `'disabled'`: return null (skip classification)
4. If `'company_defaults'`: use company settings (`classification_mode`, `classification_auto_classify`, `classification_rules`)
5. If `'custom'`: use channel overrides where non-NULL, fall back to company values otherwise. Channel rules are **appended** to company rules (both apply).

**Auto-classify resolution specifically:**
- Company `classification_auto_classify` = true, channel override = NULL → auto-classify fires
- Company `classification_auto_classify` = true, channel override = false → auto-classify does NOT fire
- Company `classification_auto_classify` = false, channel override = true → auto-classify fires
- Company `classification_auto_classify` = false, channel override = NULL → auto-classify does NOT fire

### Auto-Classify Trigger
In `messageProcessor.ts`, the existing `isNewSession` check stays, but reads config from the new location (company + channel settings) instead of `ai_agents.profile_data`. The config resolution above determines whether auto-classify should fire.

### Notification Integration
- After auto-apply: create in-app notification via existing `createNotification` service
- After suggest-mode auto-trigger: create in-app notification with action link to conversation + AI tab
- Notification type: new type `'classification'` — respects user notification preferences (added to the CHECK constraint and `notification_preferences` defaults in the migration)

---

## 7. Frontend Changes

### New Components
- `ClassificationTab.tsx` — The AI tab content (analyze button, pending suggestions, history, settings links)
- `CompanyClassificationSettings.tsx` — Company-level config card
- `ChannelClassificationSettings.tsx` — Channel-level config card

### Modified Components
- `ContactPanel.tsx` — Add third tab "AI". Convert from uncontrolled `<Tabs defaultValue="info">` to controlled `<Tabs value={activeTab} onValueChange={setActiveTab}>`. Accept new prop `initialTab?: 'info' | 'notes' | 'ai'` that sets the initial tab when the panel opens (defaults to `'info'`). Reset to `initialTab` when panel opens/closes.
- `ConversationHeader.tsx` — Wand button calls a new `onOpenClassification` callback (instead of `onClassify`). Add badge dot for pending suggestions.
- `InboxPage.tsx` — New state: `contactPanelTab`. Wand button sets `contactPanelTab = 'ai'` and opens the panel. Contact name click sets `contactPanelTab = 'info'` and opens the panel. Pass `initialTab={contactPanelTab}` to `ContactPanel`.

### Removed Components
- `ClassificationCard.tsx` — Replaced by `ClassificationTab.tsx`
- `ClassificationSettings.tsx` (from agents/) — Config removed from AI agent settings
- `ClassificationModeSettings.tsx` — Replaced by company-level settings
- Classification section from `AIAgentSections.tsx`
- Classification section from `ConversationSettingsTab.tsx`

---

## 8. Migration Path

Since classification config currently lives in `ai_agents.profile_data.classification`, a data migration is needed:

1. For each channel in `channel_agent_settings` that has an `agent_id`:
   - Look up that agent's `profile_data->'classification'` from `ai_agents`
   - **If `enabled = true`**: Set `classification_override = 'custom'`, copy `auto_classify_new` and `rules` to the channel's new columns, set `classification_mode` from the company's existing `classification_mode`
   - **If `enabled = false` or classification config is missing**: Set `classification_override = 'disabled'` — this prevents channels that never had classification from inheriting company defaults and unexpectedly turning on
2. Set `companies.classification_enabled = true` for companies that had any agent with `classification.enabled = true`
3. After migration, the backend ignores `profile_data.classification`

**Key safety rule:** Channels without explicit classification config get `classification_override = 'disabled'`, NOT `'company_defaults'`. This ensures the migration is behavior-preserving — no channel gains classification that didn't have it before. Users can then manually switch channels to "Use company defaults" if they want to opt in.

This is a SQL migration that reads the JSONB and populates the new columns.
