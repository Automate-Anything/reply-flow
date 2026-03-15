# Notification Click Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking a notification navigate to the relevant page, tab, and item (conversation or contact).

**Architecture:** Fix the server-side data key inconsistency (`sessionId` → `conversation_id`), then enhance the client-side click handler to use URL search params (`/inbox?tab=snoozed&conversation=<id>` or `/contacts?contact=<id>`). InboxPage and ContactsPage read these params on mount/change, switch to the correct tab, and select the item.

**Tech Stack:** React, React Router (`useSearchParams`), Express/Node

---

## Chunk 1: Server-side fix + Client navigation

### Task 1: Fix data key inconsistency in messageProcessor.ts

**Files:**
- Modify: `server/src/services/messageProcessor.ts:345` and `:564`

- [ ] **Step 1: Fix auto-assign notification data key**

In `server/src/services/messageProcessor.ts` at line 345, change `data: { sessionId }` to `data: { conversation_id: sessionId }`:

```typescript
// Line 339-346
createNotification({
  companyId,
  userId: assignedTo,
  type: 'assignment',
  title: 'New conversation assigned to you',
  body: `From ${msg.from_name || phoneNumber}`,
  data: { conversation_id: sessionId },
}).catch((err) => console.error('Auto-assign notification error:', err));
```

- [ ] **Step 2: Fix message_assigned notification data key**

In `server/src/services/messageProcessor.ts` at line 564, change `data: { sessionId }` to `data: { conversation_id: sessionId }`:

```typescript
// Line 558-565
createNotification({
  companyId,
  userId: session.assigned_to,
  type: 'message_assigned',
  title: `New message from ${msg.from_name || phoneNumber}`,
  body: messageBody.slice(0, 120),
  data: { conversation_id: sessionId },
}).catch((err) => console.error('Message notification error:', err));
```

- [ ] **Step 3: Commit server-side fix**

```bash
git add server/src/services/messageProcessor.ts
git commit -m "fix: use conversation_id key in messageProcessor notifications"
```

---

### Task 2: Enhance NotificationBell click handler

**Files:**
- Modify: `client/src/components/layout/NotificationBell.tsx:91-103`

- [ ] **Step 1: Build the notification type → route mapping and update handleClickNotification**

Replace the current `handleClickNotification` (lines 91-103) with a version that maps each notification type to the correct route using URL search params:

```typescript
const handleClickNotification = async (notification: Notification) => {
  if (!notification.is_read) {
    await markAsRead(notification.id);
  }
  setOpen(false);

  const conversationId = notification.data?.conversation_id as string | undefined;
  const contactId = notification.data?.contact_id as string | undefined;

  // Map notification type to target tab (only for tab-specific types)
  const tabByType: Record<string, string> = {
    snooze_set: 'snoozed',
    schedule_set: 'scheduled',
  };

  if (notification.type === 'contact_note') {
    navigate(contactId ? `/contacts?contact=${contactId}` : '/contacts');
  } else if (conversationId) {
    const tab = tabByType[notification.type];
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    params.set('conversation', conversationId);
    navigate(`/inbox?${params.toString()}`);
  } else {
    // Fallback: navigate to inbox without selecting a conversation
    navigate('/inbox');
  }
};
```

- [ ] **Step 2: Commit NotificationBell changes**

```bash
git add client/src/components/layout/NotificationBell.tsx
git commit -m "feat: notification click navigates to correct route and tab"
```

---

### Task 3: InboxPage reads URL search params

**Files:**
- Modify: `client/src/pages/InboxPage.tsx:1-2` (imports), `:30` (state init), `:94-108` (restore effect)

- [ ] **Step 1: Add useSearchParams import**

Add `useSearchParams` to the React Router import at line 1-2. InboxPage doesn't currently import from react-router-dom, so add a new import:

```typescript
import { useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: Initialize useSearchParams and read tab param for initial state**

Inside `InboxPage`, add `useSearchParams` and use the `tab` param to set the initial `activeTab` state. Replace the `useState<InboxTab>('all')` at line 30:

```typescript
const [searchParams, setSearchParams] = useSearchParams();

// Read tab from URL params (notification deep-link) for initial state
const initialTab = (() => {
  const t = searchParams.get('tab');
  if (t === 'snoozed' || t === 'scheduled' || t === 'assigned') return t;
  return 'all';
})();
const [activeTab, setActiveTab] = useState<InboxTab>(initialTab);
```

- [ ] **Step 3: Add effect to sync tab from URL params (handles already-mounted case)**

Add a new effect that watches `searchParams` and switches the active tab when the `tab` param changes. This handles the case where InboxPage is already mounted and a notification click updates the URL:

```typescript
// Sync tab from URL params (notification deep-link, works even when already mounted)
useEffect(() => {
  const t = searchParams.get('tab');
  if (t === 'snoozed' || t === 'scheduled' || t === 'assigned') {
    setActiveTab(t);
  }
}, [searchParams]);
```

- [ ] **Step 4: Add separate effect for URL-param conversation selection**

Add a new effect (separate from the sessionStorage restore) that selects a conversation from URL params. This must NOT use `restoredConvRef` so it works on repeated notification clicks:

```typescript
// Select conversation from URL params (notification click deep-link)
useEffect(() => {
  const convParam = searchParams.get('conversation');
  if (!convParam || convsLoading || conversations.length === 0) return;

  // Clean up URL params after consuming
  const newParams = new URLSearchParams(searchParams);
  newParams.delete('conversation');
  newParams.delete('tab');
  setSearchParams(newParams, { replace: true });

  const conv = conversations.find((c) => c.id === convParam);
  if (conv) {
    draftRef.current = conv.draft_message || '';
    setActiveConversation(conv);
    if (conv.unread_count > 0 || conv.marked_unread) {
      api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
    }
  }
}, [conversations, convsLoading, refetchConvs, searchParams, setSearchParams]);
```

The existing sessionStorage restore effect (lines 94-108) stays as-is for non-notification use cases.

- [ ] **Step 5: Commit InboxPage changes**

```bash
git add client/src/pages/InboxPage.tsx
git commit -m "feat: InboxPage reads tab and conversation from URL search params"
```

---

### Task 4: ContactsPage reads URL search params

**Files:**
- Modify: `client/src/pages/ContactsPage.tsx:1` (imports), after line 57 (new effect)

- [ ] **Step 1: Add useSearchParams import**

Add to imports at top of file:

```typescript
import { useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: Add useSearchParams hook and restore effect**

Inside `ContactsPage`, after the existing hooks (around line 57), add:

```typescript
const [searchParams, setSearchParams] = useSearchParams();

// Restore active contact from URL params (notification click)
useEffect(() => {
  const contactParam = searchParams.get('contact');
  if (!contactParam || loading) return;

  // Clean up URL param after consuming (only delete the one we used)
  const newParams = new URLSearchParams(searchParams);
  newParams.delete('contact');
  setSearchParams(newParams, { replace: true });

  const contact = contacts.find((c) => c.id === contactParam);
  if (contact) {
    setActiveContact(contact);
  }
}, [contacts, loading, searchParams, setSearchParams]);
```

- [ ] **Step 3: Commit ContactsPage changes**

```bash
git add client/src/pages/ContactsPage.tsx
git commit -m "feat: ContactsPage reads contact ID from URL search params"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Verify end-to-end**

Run: `npm run build`

Test manually:
1. Navigate to `/inbox?tab=snoozed&conversation=<any-id>` — should land on snoozed tab
2. Navigate to `/inbox?conversation=<any-id>` — should land on all tab and select conversation
3. Navigate to `/contacts?contact=<any-id>` — should select contact
4. Click a notification in the bell dropdown — should navigate to correct page/tab

- [ ] **Step 2: Final commit if any fixes needed**
