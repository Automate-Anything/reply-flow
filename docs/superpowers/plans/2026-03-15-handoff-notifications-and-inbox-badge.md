# Handoff Notifications & Inbox Badge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When AI hands off a conversation to a human, notify the right person (assignee or channel owner) and show a clear visual badge in the inbox list.

**Architecture:** Add a `handoff` notification type to the DB and notification service. Wire notification calls at all handoff trigger points (do_not_respond scenario match in `ai.ts`, manual pause in `routes/ai.ts`). Add a "Needs human" badge to `ConversationItem.tsx` so handoff conversations are visible at a glance in the inbox list.

**Tech Stack:** Supabase (PostgreSQL migration), Express routes, React (shadcn Badge + lucide icons)

**Notes:**
- The `/test-reply` endpoint (`routes/ai.ts:246`) also handles `do_not_respond` but is intentionally excluded — it's a playground/testing route that doesn't set `human_takeover` on real sessions.
- The "Needs human" badge auto-clears when `human_takeover` is set back to `false` via the existing `/resume/:sessionId` endpoint — no additional dismissal logic needed.

---

## Chunk 1: Database & Server

### Task 1: Add `handoff` notification type to database

**Files:**
- Create: `supabase/migrations/055_handoff_notification_type.sql`

This migration adds `handoff` to the CHECK constraint on `notifications.type` and updates the default preferences.

- [ ] **Step 1: Write the migration file**

```sql
-- Add 'handoff' to the notifications type CHECK constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assignment', 'share',
  'message_assigned', 'message_accessible',
  'snooze_set', 'schedule_set', 'schedule_sent',
  'status_change', 'contact_note',
  'handoff'
));

-- Update default preferences to include handoff (enabled by default)
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
    "handoff": true
  }'::jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/055_handoff_notification_type.sql
git commit -m "feat: add handoff notification type to database"
```

---

### Task 2: Add `handoff` to notification service preferences

**Files:**
- Modify: `server/src/services/notificationService.ts:12-22`

- [ ] **Step 1: Add `handoff` to `PREFERENCE_DEFAULTS`**

In `notificationService.ts`, add `handoff: true` to the `PREFERENCE_DEFAULTS` object:

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
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/notificationService.ts
git commit -m "feat: add handoff to notification preference defaults"
```

---

### Task 3: Create `sendHandoffNotification` helper

**Files:**
- Create: `server/src/services/handoffNotifier.ts`

This helper encapsulates the logic: look up the session's `assigned_to` and `channel_id`, then notify the assignee — or the channel owner (`whatsapp_channels.user_id`) if unassigned. It takes `companyId`, `sessionId`, and an optional `reason` string.

- [ ] **Step 1: Write `handoffNotifier.ts`**

```typescript
import { supabaseAdmin } from '../config/supabase.js';
import { createNotification } from './notificationService.js';

/**
 * Sends a handoff notification to the right person:
 * - If the conversation is assigned → notify the assignee
 * - If unassigned → notify the channel owner
 *
 * Skips notification if the triggering user is the same as the target.
 */
export async function sendHandoffNotification(
  companyId: string,
  sessionId: string,
  reason?: string,
  triggeredByUserId?: string,
): Promise<void> {
  // Get session details: assigned_to, channel_id, contact info
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('assigned_to, channel_id, contact_name, phone_number')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (!session) return;

  const contactName = session.contact_name || session.phone_number || 'Unknown';
  let targetUserId: string | null = session.assigned_to;

  // If no one is assigned, fall back to the channel owner
  if (!targetUserId && session.channel_id) {
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', session.channel_id)
      .single();

    targetUserId = channel?.user_id || null;
  }

  if (!targetUserId) return;

  // Don't notify the user who triggered the handoff
  if (triggeredByUserId && targetUserId === triggeredByUserId) return;

  const body = reason
    ? `Conversation with ${contactName} needs attention: ${reason}`
    : `Conversation with ${contactName} needs human attention`;

  await createNotification({
    companyId,
    userId: targetUserId,
    type: 'handoff',
    title: 'Human handoff',
    body,
    data: { conversation_id: sessionId, contact_name: contactName },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/handoffNotifier.ts
git commit -m "feat: add handoff notification helper with assignee/owner fallback"
```

---

### Task 4: Wire handoff notification into `do_not_respond` scenario path

**Files:**
- Modify: `server/src/services/ai.ts:716-725`

When a `do_not_respond` scenario triggers `human_takeover = true`, call `sendHandoffNotification` after setting the flag.

- [ ] **Step 1: Add import at top of `ai.ts`**

Add to the imports section:
```typescript
import { sendHandoffNotification } from './handoffNotifier.js';
```

- [ ] **Step 2: Add notification call after `human_takeover` is set**

After the existing `supabaseAdmin.from('chat_sessions').update(...)` block at line 717-724, before the `return;` at line 725, add:

```typescript
      if (matchedScenario?.do_not_respond) {
        await supabaseAdmin
          .from('chat_sessions')
          .update({
            human_takeover: true,
            auto_resume_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        // Notify assignee or channel owner about the handoff
        sendHandoffNotification(
          companyId,
          sessionId,
          `Matched scenario: ${matchedScenario.label}`,
        ).catch((err) => console.error('Handoff notification error:', err));

        return;
      }
```

Note: fire-and-forget (`.catch()`) — same pattern used for other notifications in `conversations.ts:519`.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/ai.ts
git commit -m "feat: send handoff notification on do_not_respond scenario match"
```

---

### Task 5: Wire handoff notification into manual pause endpoint

**Files:**
- Modify: `server/src/routes/ai.ts:1309-1337`

When a user manually pauses AI, send a handoff notification to the assignee (or owner if unassigned) — but skip if the user paused their own assigned conversation.

- [ ] **Step 1: Add import at top of routes/ai.ts**

```typescript
import { sendHandoffNotification } from '../services/handoffNotifier.js';
```

- [ ] **Step 2: Add notification call after the DB update**

After the `supabaseAdmin.from('chat_sessions').update(updates)` call and before `res.json(...)`, add:

```typescript
    // Notify assignee or channel owner (skip self-notification)
    sendHandoffNotification(
      companyId,
      sessionId,
      'AI manually paused',
      req.userId,
    ).catch((err) => console.error('Handoff notification error:', err));

    res.json({ status: 'paused' });
```

The `req.userId` parameter ensures the user who paused it doesn't get notified about their own action.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/ai.ts
git commit -m "feat: send handoff notification on manual AI pause"
```

---

## Chunk 2: Client UI

### Task 6: Add "Needs human" badge to inbox conversation list

**Files:**
- Modify: `client/src/components/inbox/ConversationItem.tsx:189-218`

Show a prominent badge when `human_takeover` is `true`, so users can see at a glance which conversations need human attention.

- [ ] **Step 1: Add `Hand` icon import**

Update the lucide-react import at line 6:
```typescript
import { Camera, Clock, FileText, Hand, Mic, Pin, Play, Star, Sticker } from 'lucide-react';
```

- [ ] **Step 2: Add the handoff badge to the badges row**

In the badges section (line 189-218), add the handoff badge **before** the snoozed badge so it appears first (highest visual priority):

```tsx
        {(conversation.human_takeover || conversation.labels.length > 0 || statusLabel || isSnoozed) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {conversation.human_takeover && (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10px] gap-0.5 bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
              >
                <Hand className="h-2.5 w-2.5" />
                Needs human
              </Badge>
            )}
            {isSnoozed && (
              ...existing snoozed badge...
```

Key changes:
- The outer condition now also checks `conversation.human_takeover`
- The badge uses orange styling to stand out (distinct from status/label badges)
- Uses `Hand` icon for clear visual meaning

- [ ] **Step 3: Verify the `Conversation` type already has `human_takeover`**

Confirm `client/src/hooks/useConversations.ts:34` already has `human_takeover: boolean` in the `Conversation` interface. (It does — no change needed.)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/inbox/ConversationItem.tsx
git commit -m "feat: add 'Needs human' badge to inbox list for handoff conversations"
```

---

### Task 7: Add handoff toggle to notification preferences UI

**Files:**
- Modify: `client/src/components/settings/NotificationPreferences.tsx:9-39`

Add a "Handoff" group with the `handoff` preference toggle.

- [ ] **Step 1: Add the Handoff group to `NOTIFICATION_TYPES`**

Add a new group after the existing "Assignments" group:

```typescript
const NOTIFICATION_TYPES = [
  {
    group: 'Assignments',
    items: [
      { key: 'assignment', label: 'Conversation assigned to you' },
      { key: 'share', label: 'Something shared with you' },
    ],
  },
  {
    group: 'Handoff',
    items: [
      { key: 'handoff', label: 'Conversation handed off to you' },
    ],
  },
  {
    group: 'Messages',
    items: [
      { key: 'message_assigned', label: 'New message in assigned conversation' },
      { key: 'message_accessible', label: 'New message in any accessible conversation' },
    ],
  },
  {
    group: 'Scheduling',
    items: [
      { key: 'snooze_set', label: 'Snoozed message reminder' },
      { key: 'schedule_set', label: 'Scheduled message created' },
      { key: 'schedule_sent', label: 'Scheduled message sent' },
    ],
  },
  {
    group: 'Activity',
    items: [
      { key: 'status_change', label: 'Conversation status changed' },
      { key: 'contact_note', label: 'Note added to assigned contact' },
    ],
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/NotificationPreferences.tsx
git commit -m "feat: add handoff toggle to notification preferences"
```

---

### Task 8: Build & verify

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: No TypeScript errors, clean build.

- [ ] **Step 2: Fix any build errors**

If errors occur, fix them and re-run.

- [ ] **Step 3: Final commit if any fixes were needed**

---

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| **DB** | `supabase/migrations/055_handoff_notification_type.sql` | Add `handoff` to CHECK constraint + default prefs |
| **Server** | `server/src/services/notificationService.ts` | Add `handoff: true` to `PREFERENCE_DEFAULTS` |
| **Server** | `server/src/services/handoffNotifier.ts` | New helper: resolve target user (assignee → channel owner fallback), send notification |
| **Server** | `server/src/services/ai.ts` | Call `sendHandoffNotification` on `do_not_respond` match |
| **Server** | `server/src/routes/ai.ts` | Call `sendHandoffNotification` on manual pause |
| **Client** | `client/src/components/inbox/ConversationItem.tsx` | Orange "Needs human" badge when `human_takeover = true` |
| **Client** | `client/src/components/settings/NotificationPreferences.tsx` | Add handoff toggle to preferences UI |

**Migration reminder:** After implementing, run migration `055_handoff_notification_type.sql` against the database.
