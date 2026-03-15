# Notification Click Navigation

## Problem

Clicking a notification should navigate the user to the relevant place in the app. Currently, navigation only works for notifications that have `conversation_id` in their data, and notifications created by `messageProcessor.ts` use `sessionId` instead — so they don't navigate at all.

## Navigation Map

| Notification Type | Destination | Data Required |
|-------------------|-------------|---------------|
| `assignment` | Inbox → All tab → conversation | `conversation_id` |
| `share` | Inbox → All tab → conversation | `conversation_id` |
| `message_assigned` | Inbox → All tab → conversation | `conversation_id` |
| `message_accessible` | Inbox → All tab → conversation | `conversation_id` |
| `schedule_sent` | Inbox → All tab → conversation | `conversation_id` |
| `status_change` | Inbox → All tab → conversation | `conversation_id` |
| `snooze_set` | Inbox → Snoozed tab → conversation | `conversation_id` |
| `schedule_set` | Inbox → Scheduled tab → conversation | `conversation_id` |
| `contact_note` | Contacts page → contact | `contact_id` |

## Changes

### 1. Fix data key inconsistency (server)

**File:** `server/src/services/messageProcessor.ts`

Rename `sessionId` to `conversation_id` in all `createNotification` calls so the data shape is consistent with `conversations.ts`.

### 2. Enhance click handler (client)

**File:** `client/src/components/layout/NotificationBell.tsx`

Update `handleClickNotification` to:
- Map notification type to the correct route and tab
- For inbox-bound types: navigate to `/inbox?tab=<tab>&conversation=<id>` using URL search params
- For `contact_note`: navigate to `/contacts?contact=<id>`
- **Fallback:** If the expected data field (`conversation_id` or `contact_id`) is missing, navigate to the page without selecting anything (e.g., just `/inbox` or `/contacts`)

Using URL search params instead of sessionStorage avoids a race condition where `navigate()` fires before sessionStorage is written, and also works when the user is already on the target page.

### 3. Read URL params on InboxPage (client)

**File:** `client/src/pages/InboxPage.tsx`

On mount (and when search params change), read `tab` and `conversation` from URL search params:
- If `tab` is present and valid (`snoozed`, `scheduled`), switch to that tab **before** conversations are fetched — this ensures the conversation list includes the right items (e.g., snoozed conversations only appear on the snoozed tab)
- If `conversation` is present, select that conversation after the list loads
- After consuming the params, clear them from the URL (using `replace` to avoid polluting browser history)

This replaces the existing sessionStorage-based conversation restore. The existing `reply-flow-active-conversation` sessionStorage key can be kept as a fallback for non-notification use cases.

### 4. Read URL params on ContactsPage (client)

**File:** `client/src/pages/ContactsPage.tsx`

On mount, read `contact` from URL search params:
- If present, select/highlight that contact (may need to fetch by ID if not in the initially loaded list)
- Clear the param from the URL after consuming it

## Data Contract for Future Notification Types

When wiring up notification types that are not yet triggered, their `data` field must include:
- `conversation_id` (string) for all inbox-bound types
- `contact_id` (string) for `contact_note`

This avoids recreating the `sessionId` vs `conversation_id` inconsistency.

## Out of Scope

- Wiring up notification triggers for types not yet created (`snooze_set`, `schedule_set`, `schedule_sent`, `contact_note`, `share`, `message_accessible`)
- Database or API changes (none needed)
- New routes (none needed)
