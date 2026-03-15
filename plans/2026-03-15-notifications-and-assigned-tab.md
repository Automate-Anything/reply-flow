# In-App Notifications + Preferences + "Assigned to Me" Tab

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app notification system with a bell icon + unread count, per-user notification preferences in profile settings, and an "Assigned to Me" quick-filter tab in the inbox with unread count badge.

**Architecture:** New `notifications` table stores events per user. New `notification_preferences` table stores per-user toggle settings. Notifications are delivered via Supabase Realtime subscriptions. A `useNotifications` hook manages state. Notification creation is server-side — helper functions are called from relevant services (message processor, conversation update, etc.). The "Assigned to Me" tab is added to the inbox tab bar and applies the existing `assignee: ['me']` filter.

**Tech Stack:** Supabase (Postgres migration, RLS, Realtime), Express routes, React (shadcn UI, lucide icons)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/052_notifications.sql` | Migration: notifications + notification_preferences tables |
| Create | `server/src/services/notificationService.ts` | Server-side notification creation helper |
| Create | `server/src/routes/notifications.ts` | API: list, mark read, mark all read, preferences CRUD |
| Modify | `server/src/index.ts` | Register notifications route |
| Modify | `server/src/routes/conversations.ts` | Trigger notifications on assignment, status change |
| Modify | `server/src/services/messageProcessor.ts` | Trigger notifications on new message |
| Create | `client/src/hooks/useNotifications.ts` | Data-fetching + realtime hook for notifications |
| Create | `client/src/components/layout/NotificationBell.tsx` | Bell icon + dropdown in header |
| Modify | `client/src/components/layout/AppLayout.tsx` | Add NotificationBell to header |
| Create | `client/src/components/settings/NotificationPreferences.tsx` | Preferences UI for profile settings |
| Modify | `client/src/pages/ProfilePage.tsx` or settings | Add notification preferences section |
| Modify | `client/src/pages/InboxPage.tsx` | Add "Assigned to Me" tab with unread count |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/052_notifications.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'assignment', 'share',
    'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note'
  )),
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC)
  WHERE is_read = false;
CREATE INDEX idx_notifications_user_recent ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_company ON notifications (company_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (
  user_id = auth.uid()
);
-- Insert is server-side only (supabaseAdmin), no RLS policy needed for insert
-- Delete own notifications
CREATE POLICY notifications_delete ON notifications FOR DELETE USING (
  user_id = auth.uid()
);

-- Notification preferences table
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY notification_preferences_upsert ON notification_preferences FOR ALL USING (
  user_id = auth.uid()
);

-- Enable realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/052_notifications.sql
git commit -m "feat: add notifications and notification_preferences tables"
```

---

## Task 2: Notification Service (Server-Side Helper)

**Files:**
- Create: `server/src/services/notificationService.ts`

- [ ] **Step 1: Create the service**

```typescript
import { supabaseAdmin } from '../config/supabase.js';

interface CreateNotificationParams {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

/**
 * Create a notification for a user, respecting their preferences.
 * Returns null if the user has disabled this notification type.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { companyId, userId, type, title, body, data } = params;

  // Check user preferences
  const { data: prefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  // Default all to true except message_accessible
  const defaults: Record<string, boolean> = {
    assignment: true,
    share: true,
    message_assigned: true,
    message_accessible: false,
    snooze_set: true,
    schedule_set: true,
    schedule_sent: true,
    status_change: true,
    contact_note: true,
  };

  const userPrefs = prefs?.preferences || defaults;
  if (userPrefs[type] === false) return;

  await supabaseAdmin
    .from('notifications')
    .insert({
      company_id: companyId,
      user_id: userId,
      type,
      title,
      body: body || null,
      data: data || {},
    });
}

/**
 * Create notifications for multiple users at once.
 */
export async function createNotificationsForUsers(
  companyId: string,
  userIds: string[],
  type: string,
  title: string,
  body?: string,
  data?: Record<string, unknown>
): Promise<void> {
  // Batch check preferences
  const { data: allPrefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, preferences')
    .in('user_id', userIds);

  const prefsMap = new Map((allPrefs || []).map((p) => [p.user_id, p.preferences]));

  const defaults: Record<string, boolean> = {
    assignment: true, share: true, message_assigned: true,
    message_accessible: false, snooze_set: true, schedule_set: true,
    schedule_sent: true, status_change: true, contact_note: true,
  };

  const rows = userIds
    .filter((uid) => {
      const userPrefs = prefsMap.get(uid) || defaults;
      return userPrefs[type] !== false;
    })
    .map((uid) => ({
      company_id: companyId,
      user_id: uid,
      type,
      title,
      body: body || null,
      data: data || {},
    }));

  if (rows.length > 0) {
    await supabaseAdmin.from('notifications').insert(rows);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/notificationService.ts
git commit -m "feat: add notification service with preference checking"
```

---

## Task 3: Notifications API Routes

**Files:**
- Create: `server/src/routes/notifications.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List notifications for current user (paginated, newest first)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { limit = '30', offset = '0', unread_only } = req.query;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (unread_only === 'true') {
      query = query.eq('is_read', false);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Also get unread count
    const { count: unreadCount } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    res.json({ notifications: data || [], count, unread_count: unreadCount || 0 });
  } catch (err) {
    next(err);
  }
});

// Mark single notification as read
router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { notificationId } = req.params;

    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Mark all notifications as read
router.patch('/read-all', async (req, res, next) => {
  try {
    const userId = req.userId!;

    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Get notification preferences
router.get('/preferences', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const defaults = {
      assignment: true, share: true, message_assigned: true,
      message_accessible: false, snooze_set: true, schedule_set: true,
      schedule_sent: true, status_change: true, contact_note: true,
    };

    res.json({ preferences: data?.preferences || defaults });
  } catch (err) {
    next(err);
  }
});

// Update notification preferences
router.put('/preferences', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { preferences } = req.body;

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .upsert(
        { user_id: userId, preferences, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ preferences: data.preferences });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register route in server/src/index.ts**

```typescript
import notificationRoutes from './routes/notifications.js';
// ...
app.use('/api/notifications', notificationRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/notifications.ts server/src/index.ts
git commit -m "feat: add notifications API with preferences"
```

---

## Task 4: Trigger Notifications from Existing Services

**Files:**
- Modify: `server/src/routes/conversations.ts` — assignment and status change notifications
- Modify: `server/src/services/messageProcessor.ts` — new message notifications

- [ ] **Step 1: Assignment notification**

In `server/src/routes/conversations.ts`, find the PATCH `/:sessionId` handler where `assigned_to` is updated. After the update succeeds, if `assigned_to` changed to a non-null value and it's not self-assignment:

```typescript
import { createNotification } from '../services/notificationService.js';

// After assignment update:
if (assigned_to && assigned_to !== req.userId) {
  const contactName = session.contact_name || session.phone_number;
  await createNotification({
    companyId,
    userId: assigned_to,
    type: 'assignment',
    title: 'New assignment',
    body: `You were assigned a conversation with ${contactName}`,
    data: { conversation_id: sessionId, contact_name: contactName },
  });
}
```

- [ ] **Step 2: Status change notification**

In the same file, when status is changed on a conversation that has an `assigned_to` user (and the change isn't by the assignee themselves):

```typescript
if (status && session.assigned_to && session.assigned_to !== req.userId) {
  await createNotification({
    companyId,
    userId: session.assigned_to,
    type: 'status_change',
    title: 'Status changed',
    body: `Conversation status changed to ${status}`,
    data: { conversation_id: sessionId, new_status: status },
  });
}
```

- [ ] **Step 3: New message notification for assigned user**

In `server/src/services/messageProcessor.ts`, after a new inbound message is saved, if the conversation has an `assigned_to` user and it's an incoming message:

```typescript
import { createNotification, createNotificationsForUsers } from './notificationService.js';

// After saving inbound message:
if (session.assigned_to) {
  const contactName = session.contact_name || session.phone_number;
  await createNotification({
    companyId: session.company_id,
    userId: session.assigned_to,
    type: 'message_assigned',
    title: `New message from ${contactName}`,
    body: messagePreview,
    data: { conversation_id: session.id, message_id: newMessage.id },
  });
}
```

- [ ] **Step 4: Accessible message notification (separate type)**

For `message_accessible`, notify other team members who have access to this conversation (via conversation_access table or company members), excluding the assigned user (already notified) and the sender:

```typescript
// Get users with access to this conversation (simplified: all company members)
// This is the "message_accessible" type that users can turn off in preferences
const { data: companyMembers } = await supabaseAdmin
  .from('company_members')
  .select('user_id')
  .eq('company_id', session.company_id);

const otherUserIds = (companyMembers || [])
  .map((m) => m.user_id)
  .filter((uid) => uid !== session.assigned_to && uid !== req.userId);

if (otherUserIds.length > 0) {
  await createNotificationsForUsers(
    session.company_id,
    otherUserIds,
    'message_accessible',
    `New message from ${contactName}`,
    messagePreview,
    { conversation_id: session.id, message_id: newMessage.id }
  );
}
```

Note: `message_accessible` defaults to **off** in preferences, so this won't be noisy unless users opt in.

- [ ] **Step 5: Snooze/Schedule/Note notifications**

Add notification calls in the relevant handlers:
- **Snooze set**: When `snoozed_until` is set on a conversation (in conversations.ts PATCH)
- **Schedule set/sent**: In the scheduled messages handlers
- **Contact note**: In the contact notes route when a note is added

These follow the same pattern — call `createNotification()` with the appropriate type, title, body, and data.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/conversations.ts server/src/services/messageProcessor.ts
git commit -m "feat: trigger notifications on assignment, status change, and new messages"
```

---

## Task 5: Notifications Hook (Client-Side)

**Files:**
- Create: `client/src/hooks/useNotifications.ts`

- [ ] **Step 1: Create the hook with realtime subscription**

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications?limit=50');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch {
      console.error('Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const markAsRead = useCallback(async (notificationId: string) => {
    await api.patch(`/notifications/${notificationId}/read`);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    await api.patch('/notifications/read-all');
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, refetch: fetchNotifications };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useNotifications.ts
git commit -m "feat: add useNotifications hook with realtime subscription"
```

---

## Task 6: Notification Bell Component

**Files:**
- Create: `client/src/components/layout/NotificationBell.tsx`
- Modify: `client/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create the bell component**

Build a component with:
- Bell icon (`Bell` from lucide-react)
- Unread count badge (red circle with number)
- Click opens a Popover or DropdownMenu showing recent notifications
- Each notification item shows: icon by type, title, body preview, time ago, read/unread indicator
- Click on a notification: mark as read + navigate to relevant conversation (using `data.conversation_id`)
- "Mark all as read" button at the top
- Link to notification preferences at the bottom

```tsx
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from '@/hooks/useNotifications';
import { useNavigate } from 'react-router-dom';
// ... component implementation
```

The bell renders:
```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="ghost" size="icon" className="relative h-8 w-8">
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-80 p-0" align="end">
    {/* Header with "Notifications" title and "Mark all read" */}
    {/* Scrollable list of notifications */}
    {/* Footer with link to preferences */}
  </PopoverContent>
</Popover>
```

- [ ] **Step 2: Add NotificationBell to AppLayout header**

In `client/src/components/layout/AppLayout.tsx`, import and add `<NotificationBell />` in the header bar, next to existing header actions (likely near user avatar or settings).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/layout/NotificationBell.tsx client/src/components/layout/AppLayout.tsx
git commit -m "feat: add notification bell with realtime updates to header"
```

---

## Task 7: Notification Preferences UI

**Files:**
- Create: `client/src/components/settings/NotificationPreferences.tsx`
- Modify: profile/settings page where preferences should appear

- [ ] **Step 1: Create the preferences component**

```tsx
import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

const NOTIFICATION_TYPES = [
  { group: 'Assignments', items: [
    { key: 'assignment', label: 'Conversation assigned to you' },
    { key: 'share', label: 'Something shared with you' },
  ]},
  { group: 'Messages', items: [
    { key: 'message_assigned', label: 'New message in assigned conversation' },
    { key: 'message_accessible', label: 'New message in any accessible conversation' },
  ]},
  { group: 'Scheduling', items: [
    { key: 'snooze_set', label: 'Snoozed message reminder' },
    { key: 'schedule_set', label: 'Scheduled message created' },
    { key: 'schedule_sent', label: 'Scheduled message sent' },
  ]},
  { group: 'Activity', items: [
    { key: 'status_change', label: 'Conversation status changed' },
    { key: 'contact_note', label: 'Note added to assigned contact' },
  ]},
];

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications/preferences').then(({ data }) => {
      setPrefs(data.preferences);
      setLoading(false);
    });
  }, []);

  const handleToggle = async (key: string, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    try {
      await api.put('/notifications/preferences', { preferences: updated });
    } catch {
      setPrefs(prefs); // revert on error
      toast.error('Failed to update preference');
    }
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-6">
      {NOTIFICATION_TYPES.map((group) => (
        <div key={group.group}>
          <h4 className="text-sm font-medium mb-3">{group.group}</h4>
          <div className="space-y-3">
            {group.items.map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <Label className="text-sm font-normal">{item.label}</Label>
                <Switch
                  checked={prefs[item.key] ?? true}
                  onCheckedChange={(v) => handleToggle(item.key, v)}
                />
              </div>
            ))}
          </div>
          <Separator className="mt-4" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add to profile/settings page**

Find the profile page or settings page and add a "Notifications" section with the `<NotificationPreferences />` component.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/NotificationPreferences.tsx client/src/pages/
git commit -m "feat: add notification preferences UI in profile settings"
```

---

## Task 8: "Assigned to Me" Tab in Inbox

**Files:**
- Modify: `client/src/pages/InboxPage.tsx`

- [ ] **Step 1: Add 'assigned' to InboxTab type**

```typescript
type InboxTab = 'all' | 'assigned' | 'snoozed' | 'scheduled';
```

- [ ] **Step 2: Add 'assigned' to effectiveFilters**

Update the `effectiveFilters` useMemo:

```typescript
const effectiveFilters = useMemo(() => {
  if (activeTab === 'snoozed') return { ...filters, snoozed: true };
  if (activeTab === 'assigned') return { ...filters, assignee: ['me'] };
  return filters;
}, [activeTab, filters]);
```

- [ ] **Step 3: Add the tab button to the tab bar**

Update the tab bar array in `InboxPage.tsx` (around line 376):

```typescript
import { CalendarClock, Clock, MessageSquare, UserCheck } from 'lucide-react';

// In the tabBar:
{([
  { key: 'all', label: 'All', icon: MessageSquare },
  { key: 'assigned', label: 'Assigned to Me', icon: UserCheck },
  { key: 'snoozed', label: 'Snoozed', icon: Clock },
  { key: 'scheduled', label: 'Scheduled', icon: CalendarClock },
] as const).map(({ key, label, icon: Icon }) => (
  // ... existing button render
))}
```

- [ ] **Step 4: Add unread count badge to the "Assigned to Me" tab**

To show the unread count badge, track the count of assigned conversations with unread messages. Add a lightweight API call or compute from existing data:

```typescript
// In InboxPage, fetch assigned unread count:
const [assignedUnreadCount, setAssignedUnreadCount] = useState(0);

useEffect(() => {
  api.get('/conversations?assignee=me&has_unread=true&limit=0')
    .then(({ data }) => setAssignedUnreadCount(data.count || 0))
    .catch(() => {});
}, [conversations]); // Re-fetch when conversations change
```

Then in the tab button, add a badge:

```tsx
<button key={key} onClick={...} className={...}>
  <Icon className="h-3.5 w-3.5" />
  {label}
  {key === 'assigned' && assignedUnreadCount > 0 && (
    <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
      {assignedUnreadCount}
    </span>
  )}
</button>
```

- [ ] **Step 5: Update showConversationList logic**

```typescript
const showConversationList = activeTab !== 'scheduled';
```

This already handles 'assigned' correctly since it's not 'scheduled'.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/InboxPage.tsx
git commit -m "feat: add 'Assigned to Me' tab with unread count badge to inbox"
```

---

## Task 9: Build & Verify

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: No TypeScript errors, successful build.

- [ ] **Step 2: Manual testing checklist**

- Assign a conversation to another user → verify they receive a notification
- Check the notification bell shows the unread count
- Click a notification → verify it navigates to the conversation and marks as read
- "Mark all as read" → verify all notifications clear
- Go to notification preferences → toggle off "message_assigned" → verify no more message notifications
- Toggle "message_accessible" ON → verify you get notifications for all accessible conversations
- Click "Assigned to Me" tab → verify it shows only conversations assigned to current user
- Verify unread count badge on "Assigned to Me" tab updates correctly
- Status change on assigned conversation → verify assignee gets notification
- Add note to a contact → verify assignee gets notification
