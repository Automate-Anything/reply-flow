# Contact Detail Page v2 — Full Redesign

## Problem

The v1 redesign (hiding empty fields, merging cards) made the page feel even emptier. The core issue: the Details tab is a static property list with no dynamic content. Major CRMs (HubSpot, Salesforce, Freshsales) all show an "Overview" as the default view — a mix of properties, stats, and recent activity.

Additionally: notes are buried in the activity timeline, there's no way to view conversation messages from the contact page, sessions tab is underutilized, and memories can't be edited.

## Tab Structure

**Before (4 tabs):** Details | Activity | Sessions | Memories

**After (5 tabs):** Overview | Activity | Conversations | Notes | Memories

| Tab | What Changed |
|-----|-------------|
| **Overview** | Renamed from "Details". Adds quick stats bar + recent activity preview below the properties card |
| **Activity** | Notes removed from timeline (moved to Notes tab). Otherwise same. |
| **Conversations** | Replaces "Sessions". Session cards now clickable → opens inline message thread. Adds channel name, memory count per session. |
| **Notes** | New tab. Dedicated note management: add, edit, delete. Pulled out of activity timeline. |
| **Memories** | Adds edit capability (pencil icon → inline text edit). |

## Detailed Design

### 1. Overview Tab

Three sections stacked vertically inside scrollable area:

#### Quick Stats Bar
Compact horizontal strip at top of tab content. Shows 3-4 key metrics:
- **Messages** — total message count across all sessions (sum of `message_count` from sessions)
- **Conversations** — number of sessions
- **Last active** — relative time since last message (`last_message_at` from most recent session)

Styled as a light `bg-muted/50` rounded bar with stats separated by vertical dividers. Icons + numbers + labels.

Data source: sessions are fetched eagerly on Overview tab mount (the default tab). This adds a network request on initial load, but the sessions endpoint is lightweight. Stats are computed client-side from the response.

#### Details Card
Single `rounded-lg border bg-card` containing:
- **Contact** section: Phone, Email, WhatsApp — all fields shown, "—" for empty (reverted from v1 hidden approach)
- **Personal** section: First Name, Last Name, Company — all shown
- **Tags** section: inside card, only if contact has tags
- **Lists** section: inside card, only if contact has lists
- **Notes** section: removed (now its own tab)
- **Address** section: only if populated
- **Custom Fields** section: only if any exist

#### Recent Activity Preview
Shows the last 3 events from the activity timeline (excluding notes). Compact format: icon + event description + relative timestamp. A "View all activity →" link at the bottom that switches to the Activity tab.

Data source: `useContactActivity` hook already fetched. Slice first 3 events client-side, filtering out `note` type events.

### 2. Activity Tab

Same as current `ActivityTimeline` component, with two changes:
- **Remove note creation UI** (textarea + submit) — moved to Notes tab
- **Filter out note events** from the timeline — notes are no longer shown here

The `onAddNote` and `onDeleteNote` props can be removed from this tab's usage.

### 3. Conversations Tab (replaces Sessions)

#### Session List View
Each session card shows (enhanced from current):
- Status badge (Active / resolved / closed)
- Session number (#1, #2, etc.)
- **Channel name** (from `whatsapp_channels` table via `channel_id`)
- Date range (created → ended or "now")
- Message count + duration (same as current)
- **Memory count** — small brain icon + count if memories exist for this session
- Last message preview (same as current)
- **Entire card is clickable** → opens message view

#### Message View (inline)
When a session card is clicked:
- Session list is replaced by a message thread view (same panel, not a modal)
- **Back button** at top to return to session list
- **Session header** showing status, date range, channel
- **Message list** — a new `ReadOnlyMessageList` component that renders message bubbles without `MessageInput`, `MessageContextMenu`, or any interactive send/reply/forward props. The existing `MessageThread` component has ~15 required interactive props and is not suitable for direct reuse. Instead, extract the message rendering logic (bubble layout, direction styling, timestamps, media display) into the new component.
- Messages fetched from `GET /conversations/:sessionId/messages`

This requires:
- A new `ReadOnlyMessageList` component for rendering message history
- Fetching messages for a specific session (endpoint already exists)
- No send capability — this is read-only history

#### Backend Changes
- Extend `GET /contacts/:contactId/sessions` to include `channel_name` (join with `whatsapp_channels`)
- Extend response to include `memory_count` per session. Approach: fetch all memories for the contact (already available via existing endpoint), count per `session_id` in JS. This avoids raw SQL and follows the existing `message_count` pattern (lines 1031-1039 in contacts.ts).

### 4. Notes Tab (new)

Dedicated note management for the contact.

#### Layout
- **Add note** area at top: textarea with placeholder "Add a note..." + submit button (or Ctrl/Cmd+Enter)
- **Notes list** below: chronological (newest first), each note shows:
  - Author name + avatar
  - Relative timestamp
  - Note content (full text, whitespace preserved)
  - **Edit button** (pencil icon, hover)
  - **Delete button** (trash icon, hover, with confirmation)

#### Edit Flow
Click pencil → note content becomes an editable textarea with Save/Cancel buttons. Uses existing `PUT /contact-notes/:contactId/:noteId` endpoint.

#### Data Source
New hook or extend existing: `GET /contact-notes/:contactId` — fetches all notes for a contact (not filtered by session). The route already exists in `server/src/routes/contactNotes.ts`.

### 5. Memories Tab

Same as current, with one addition:

#### Edit Memory
- **Pencil icon** appears on hover (same pattern as the existing X delete button)
- Click pencil → memory content becomes an editable textarea with Save/Cancel buttons
- Save calls `PATCH /contacts/:contactId/memories/:memoryId` with `{ content: "new text" }`

#### Backend Change
- Extend existing `PATCH /contacts/:contactId/memories/:memoryId` to accept `content` field in addition to `is_active`
- Fix latent bug: currently if you PATCH without `is_active`, it defaults to `false` (deactivating the memory). Change to only update fields that are provided: `const updates: Record<string, unknown> = {}; if (is_active !== undefined) updates.is_active = is_active; if (content) updates.content = content;`

## Files Changed

| File | Change |
|------|--------|
| `client/src/components/contacts/ContactDetail.tsx` | Major rewrite: Overview tab, Conversations tab, Notes tab, Memories edit |
| `server/src/routes/contacts.ts` | Extend sessions endpoint (channel_name, memory_count), extend memories PATCH (content) |
| `client/src/components/contacts/ActivityTimeline.tsx` | Remove note creation UI, filter out note events |
| `client/src/components/contacts/ContactNotes.tsx` | **New file**: Notes tab component with CRUD |
| `client/src/components/contacts/ContactConversations.tsx` | **New file**: Conversations tab with session list + message viewer |
| `client/src/components/contacts/ReadOnlyMessageList.tsx` | **New file**: Read-only message bubble renderer (extracted from MessageThread patterns) |
| `client/src/hooks/useContactNotes.ts` | **New file**: Hook for fetching/managing contact notes |

No migrations needed. No new database tables. All data already exists.

## Acceptance Criteria

- [ ] Overview tab shows quick stats bar (messages, conversations, last active)
- [ ] Overview tab shows properties card with all fields (empty = "—")
- [ ] Overview tab shows recent activity preview (last 3 events, no notes)
- [ ] "View all activity →" link switches to Activity tab
- [ ] Activity tab no longer shows notes or note creation UI
- [ ] Conversations tab shows enhanced session cards (channel name, memory count)
- [ ] Clicking a session card opens inline message thread (read-only)
- [ ] Back button returns from message thread to session list
- [ ] Notes tab shows all contact notes with add/edit/delete
- [ ] Notes tab supports Ctrl/Cmd+Enter to submit
- [ ] Memories tab has edit capability (pencil icon → inline textarea)
- [ ] Sessions endpoint returns channel_name and memory_count
- [ ] Memories PATCH endpoint accepts content updates
- [ ] Build passes with no TypeScript errors
