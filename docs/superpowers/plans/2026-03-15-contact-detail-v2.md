# Contact Detail Page v2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the contact detail page with an Overview tab (stats + recent activity), dedicated Notes tab, clickable Conversations tab with inline message viewer, and editable Memories.

**Architecture:** Backend: extend 2 existing endpoints. Frontend: rewrite ContactDetail tabs, create 3 new components (ContactNotes, ContactConversations, ReadOnlyMessageList), create 1 new hook (useContactNotes). Revert v1's hidden-empty-fields approach.

**Tech Stack:** React, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons, Express, Supabase

**Spec:** `docs/superpowers/specs/2026-03-15-contact-detail-v2-design.md`

---

## Chunk 1: Backend Changes

### Task 1: Extend sessions endpoint with channel_name and memory_count

**Files:**
- Modify: `server/src/routes/contacts.ts` (sessions endpoint, ~lines 1009-1050)

- [ ] **Step 1: Add channel_name to sessions query**

In the sessions endpoint handler, after fetching sessions, do a separate query to get channel names for all unique `channel_id` values. Then merge into the response.

```typescript
// After fetching sessions, get channel names
const channelIds = [...new Set(sessions.filter((s: any) => s.channel_id).map((s: any) => s.channel_id))];
let channelMap = new Map<number, string>();
if (channelIds.length > 0) {
  const { data: channels } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('id, display_name')
    .in('id', channelIds);
  if (channels) {
    channelMap = new Map(channels.map((c: any) => [c.id, c.display_name]));
  }
}
```

Then enrich each session:
```typescript
const enrichedSessions = sessions.map((s: any) => ({
  ...s,
  channel_name: s.channel_id ? channelMap.get(s.channel_id) || null : null,
}));
```

- [ ] **Step 2: Add memory_count to sessions response**

After fetching sessions, query contact_memories grouped by session_id:

```typescript
const { data: memoryCounts } = await supabaseAdmin
  .from('contact_memories')
  .select('session_id')
  .eq('contact_id', contactId)
  .eq('company_id', companyId)
  .eq('is_active', true);

const memoryCountMap = new Map<string, number>();
if (memoryCounts) {
  for (const m of memoryCounts) {
    memoryCountMap.set(m.session_id, (memoryCountMap.get(m.session_id) || 0) + 1);
  }
}
```

Add to enriched sessions: `memory_count: memoryCountMap.get(s.id) || 0`

- [ ] **Step 3: Update response**

Replace `res.json({ sessions })` with `res.json({ sessions: enrichedSessions })`.

- [ ] **Step 4: Verify**

Run: `npm run build --prefix server`

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/contacts.ts
git commit -m "feat: extend sessions endpoint with channel_name and memory_count"
```

---

### Task 2: Fix memories PATCH endpoint to support content editing

**Files:**
- Modify: `server/src/routes/contacts.ts` (memories PATCH, ~lines 1074-1091)

- [ ] **Step 1: Update the PATCH handler**

Replace the current destructuring and update logic with:

```typescript
const { is_active, content } = req.body;
const updates: Record<string, unknown> = {};
if (is_active !== undefined) updates.is_active = is_active;
if (content !== undefined) updates.content = content;

if (Object.keys(updates).length === 0) {
  return res.status(400).json({ error: 'No fields to update' });
}

const { error } = await supabaseAdmin
  .from('contact_memories')
  .update(updates)
  .eq('id', memoryId)
  .eq('contact_id', contactId)
  .eq('company_id', companyId);
```

This fixes the latent bug where omitting `is_active` would default to `false`.

- [ ] **Step 2: Verify**

Run: `npm run build --prefix server`

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/contacts.ts
git commit -m "feat: extend memories PATCH to support content editing"
```

---

## Chunk 2: useContactNotes Hook + ContactNotes Component

### Task 3: Create useContactNotes hook

**Files:**
- Create: `client/src/hooks/useContactNotes.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ContactNote {
  id: string;
  content: string;
  created_by: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  author?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
}

export function useContactNotes(contactId: string) {
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/contact-notes/${contactId}`);
      setNotes(data.notes || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addNote = async (content: string) => {
    await api.post(`/contact-notes/${contactId}`, { content });
    await fetch();
  };

  const updateNote = async (noteId: string, content: string) => {
    await api.put(`/contact-notes/${contactId}/${noteId}`, { content });
    await fetch();
  };

  const deleteNote = async (noteId: string) => {
    await api.delete(`/contact-notes/${contactId}/${noteId}`);
    await fetch();
  };

  return { notes, loading, refetch: fetch, addNote, updateNote, deleteNote };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useContactNotes.ts
git commit -m "feat: add useContactNotes hook"
```

---

### Task 4: Create ContactNotes component

**Files:**
- Create: `client/src/components/contacts/ContactNotes.tsx`

- [ ] **Step 1: Create the component**

A dedicated notes tab with:
- Textarea at top for adding new notes (Ctrl/Cmd+Enter to submit)
- Notes list below (newest first)
- Each note: author avatar + name, relative timestamp, content
- Hover reveals edit (pencil) and delete (trash) buttons
- Edit mode: textarea replaces content with Save/Cancel buttons
- Delete: uses ConfirmDialog

The component receives `contactId` as a prop and uses `useContactNotes` internally.

Key imports: `useState` from react, `Button`, `Textarea` (or raw textarea), `ConfirmDialog`, `Loader2`, `Pencil`, `Trash2`, `StickyNote` from lucide-react.

Structure:
```
<div className="space-y-4">
  {/* Add note area */}
  <div className="space-y-2">
    <textarea ... />
    <Button onClick={addNote}>Add Note</Button>
  </div>

  {/* Notes list */}
  {loading ? <Loader2 spinner /> : notes.length === 0 ? <empty state> : (
    <div className="space-y-3">
      {notes.map(note => <NoteCard key={note.id} ... />)}
    </div>
  )}
</div>
```

Each NoteCard:
```
<div className="group rounded-lg border bg-card p-3">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <avatar />
      <span className="text-sm font-medium">{author name}</span>
      <span className="text-xs text-muted-foreground">{relative time}</span>
    </div>
    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
      <Button size="icon" variant="ghost" onClick={startEdit}><Pencil /></Button>
      <ConfirmDialog onConfirm={delete}><Button size="icon" variant="ghost"><Trash2 /></Button></ConfirmDialog>
    </div>
  </div>
  {editing ? (
    <div className="mt-2 space-y-2">
      <textarea value={editContent} onChange={...} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" onClick={cancel}>Cancel</Button>
      </div>
    </div>
  ) : (
    <p className="mt-2 text-sm whitespace-pre-wrap">{note.content}</p>
  )}
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/contacts/ContactNotes.tsx
git commit -m "feat: add ContactNotes component for notes tab"
```

---

## Chunk 3: ReadOnlyMessageList + ContactConversations

### Task 5: Create ReadOnlyMessageList component

**Files:**
- Create: `client/src/components/contacts/ReadOnlyMessageList.tsx`

- [ ] **Step 1: Create the component**

A simplified message renderer extracted from MessageBubble patterns. No interactive props (no reply, forward, react, send). Renders:
- Message bubbles with direction-based alignment (outbound right, inbound left)
- Color coding: AI=purple, human outbound=primary, inbound=muted
- Text content with `whitespace-pre-wrap`
- Timestamps with sender label (AI/You) and status icon
- Media: images (with img tag), documents (file icon + name), audio/video (native elements)
- Quoted messages (from `metadata.reply`)
- Reactions (emoji badges)

Props:
```typescript
interface ReadOnlyMessageListProps {
  messages: Message[];
  loading: boolean;
  contactName?: string;
}
```

Keep it simple — this is a read-only history viewer, not the full inbox. Skip link previews, voice note player animations, lightbox modals, and context menus. Show images inline, documents as download links, audio/video with native controls.

Use `useMediaUrl` hook from `client/src/hooks/useMediaUrl.ts` for media files stored in Supabase storage.

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/contacts/ReadOnlyMessageList.tsx
git commit -m "feat: add ReadOnlyMessageList component for conversation history"
```

---

### Task 6: Create ContactConversations component

**Files:**
- Create: `client/src/components/contacts/ContactConversations.tsx`

- [ ] **Step 1: Create the component**

Two views managed by local state:

**Session List View** (default):
- Enhanced version of current sessions rendering from ContactDetail.tsx
- Each card shows: status badge, session number, channel name, date range, message count, duration, memory count (brain icon), last message preview
- Entire card is clickable (cursor-pointer, hover bg)
- Empty state: "No conversations yet"
- Loading state: spinner

**Message View** (when a session is selected):
- Back button at top → returns to session list
- Session header: status badge + channel name + date range
- ReadOnlyMessageList below with messages fetched from `/conversations/:sessionId/messages`
- Loading state while messages fetch

Props:
```typescript
interface ContactConversationsProps {
  contactId: string;
  sessions: ContactSession[];  // from parent (already fetched)
  sessionsLoading: boolean;
}
```

The `ContactSession` interface needs to be extended to include `channel_name` and `memory_count`.

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/contacts/ContactConversations.tsx
git commit -m "feat: add ContactConversations component with inline message viewer"
```

---

## Chunk 4: ContactDetail.tsx Rewrite

### Task 7: Rewrite ContactDetail.tsx with new tab structure

**Files:**
- Modify: `client/src/components/contacts/ContactDetail.tsx`

This is the largest task. Changes:

- [ ] **Step 1: Update imports**

Add imports for new components and hooks:
```typescript
import ContactNotes from './ContactNotes';
import ContactConversations from './ContactConversations';
```

Add `MessageSquare` and `StickyNote` to Lucide imports (for tab icons or stats). Remove `List` if not used elsewhere.

- [ ] **Step 2: Revert DetailField to show empty values**

Change `DetailField` back to showing "—" for empty values:
```typescript
function DetailField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{value || '—'}</span>
    </div>
  );
}
```

- [ ] **Step 3: Revert DetailSection to always show (remove conditional wrapper on Personal)**

Remove the `(contact.first_name || contact.last_name || contact.company) &&` guard around the Personal section. Both Contact and Personal sections always render.

- [ ] **Step 4: Fetch sessions eagerly for Overview stats**

Move sessions fetch to trigger on component mount (not just when Sessions tab is selected). The sessions data is needed for the Quick Stats bar on the Overview tab.

Change the lazy-load useEffect to fetch sessions immediately:
```typescript
useEffect(() => {
  if (!sessionsFetched.current && !sessionsLoading) fetchSessions();
  if (activeTab === 'memories' && !memoriesFetched.current && !memoriesLoading) fetchMemories();
}, [activeTab, sessionsLoading, fetchSessions, memoriesLoading, fetchMemories]);
```

- [ ] **Step 5: Add Quick Stats bar to Overview tab**

Above the details card, render a stats bar:
```tsx
<div className="mb-4 flex items-center gap-6 rounded-lg bg-muted/50 px-4 py-3">
  <div className="flex items-center gap-2">
    <MessageSquare className="h-4 w-4 text-muted-foreground" />
    <div>
      <p className="text-lg font-semibold">{totalMessages}</p>
      <p className="text-xs text-muted-foreground">Messages</p>
    </div>
  </div>
  <div className="h-8 w-px bg-border" />
  <div className="flex items-center gap-2">
    <Hash className="h-4 w-4 text-muted-foreground" />
    <div>
      <p className="text-lg font-semibold">{sessions.length}</p>
      <p className="text-xs text-muted-foreground">Conversations</p>
    </div>
  </div>
  <div className="h-8 w-px bg-border" />
  <div className="flex items-center gap-2">
    <Clock className="h-4 w-4 text-muted-foreground" />
    <div>
      <p className="text-lg font-semibold">{lastActiveLabel}</p>
      <p className="text-xs text-muted-foreground">Last active</p>
    </div>
  </div>
</div>
```

Compute stats:
```typescript
const totalMessages = sessions.reduce((sum, s) => sum + s.message_count, 0);
const lastActive = sessions
  .map(s => s.last_message_at)
  .filter(Boolean)
  .sort()
  .reverse()[0];
const lastActiveLabel = lastActive ? formatTimeAgo(lastActive) : 'Never';
```

- [ ] **Step 6: Add Recent Activity preview to Overview tab**

After the details card, add:
```tsx
{/* Recent Activity */}
<div className="mt-4 rounded-lg border bg-card">
  <div className="px-4 pb-1 pt-3">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h4>
  </div>
  <div className="divide-y">
    {recentEvents.length === 0 ? (
      <p className="px-4 py-3 text-sm text-muted-foreground">No activity yet</p>
    ) : (
      recentEvents.map((event, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <span className="text-muted-foreground">{getEventIcon(event)}</span>
          <span className="flex-1 truncate text-sm">{getEventLabel(event)}</span>
          <span className="text-xs text-muted-foreground">{formatTimeAgo(event.timestamp)}</span>
        </div>
      ))
    )}
  </div>
  {events.length > 0 && (
    <button
      className="w-full border-t px-4 py-2 text-center text-xs text-primary hover:bg-muted/50"
      onClick={() => setActiveTab('activity')}
    >
      View all activity →
    </button>
  )}
</div>
```

Compute recent events (filter out notes, take first 3):
```typescript
const recentEvents = events.filter(e => e.type !== 'note').slice(0, 3);
```

Helper functions `getEventIcon` and `getEventLabel` map event types to icons and descriptions (similar to what ActivityTimeline already does).

- [ ] **Step 7: Update tab structure**

Replace the current Tabs with:
```tsx
<TabsList className="mx-6 mt-4 w-fit">
  <TabsTrigger value="overview">Overview</TabsTrigger>
  <TabsTrigger value="activity">Activity</TabsTrigger>
  <TabsTrigger value="conversations">Conversations</TabsTrigger>
  <TabsTrigger value="notes">Notes</TabsTrigger>
  <TabsTrigger value="memories">Memories</TabsTrigger>
</TabsList>
```

Update default `activeTab` state from `'details'` to `'overview'`.

- [ ] **Step 8: Replace Sessions tab with Conversations tab**

Replace the sessions TabsContent with:
```tsx
<TabsContent value="conversations" className="flex-1 overflow-auto px-6 py-4">
  <ContactConversations
    contactId={contact.id}
    sessions={sessions}
    sessionsLoading={sessionsLoading}
  />
</TabsContent>
```

- [ ] **Step 9: Add Notes tab**

```tsx
<TabsContent value="notes" className="flex-1 overflow-auto px-6 py-4">
  <ContactNotes contactId={contact.id} />
</TabsContent>
```

- [ ] **Step 10: Remove note props from Activity tab**

The ActivityTimeline should no longer receive `onAddNote` or `onDeleteNote`. Filter out note events before passing:

```tsx
<TabsContent value="activity" className="flex-1 overflow-auto px-6 py-4">
  <ActivityTimeline
    events={events.filter(e => e.type !== 'note')}
    loading={activityLoading}
    hasMore={hasMore}
    onLoadMore={loadMore}
    loadingMore={loadingMore}
  />
</TabsContent>
```

- [ ] **Step 11: Add edit capability to Memories tab**

Add editing state and handler. Each memory gets a pencil icon (hover) that toggles an inline textarea:

```tsx
const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
const [editingMemoryContent, setEditingMemoryContent] = useState('');

const handleSaveMemory = async (memoryId: string) => {
  try {
    await api.patch(`/contacts/${contact.id}/memories/${memoryId}`, { content: editingMemoryContent });
    setMemories(prev => prev.map(m => m.id === memoryId ? { ...m, content: editingMemoryContent } : m));
    setEditingMemoryId(null);
  } catch { /* ignore */ }
};
```

In the memory card, add pencil button next to the X button, and replace content `<p>` with a textarea when editing.

- [ ] **Step 12: Verify build**

Run: `npm run build`

- [ ] **Step 13: Commit**

```bash
git add client/src/components/contacts/ContactDetail.tsx
git commit -m "feat: rewrite ContactDetail with Overview, Conversations, Notes tabs and memory editing"
```

---

## Chunk 5: ActivityTimeline Cleanup

### Task 8: Remove note UI from ActivityTimeline

**Files:**
- Modify: `client/src/components/contacts/ActivityTimeline.tsx`

- [ ] **Step 1: Make note props optional**

Change `onAddNote` and `onDeleteNote` from required to optional props. When not provided, hide the note creation textarea and delete buttons for notes.

This keeps ActivityTimeline backward-compatible (it may be used elsewhere) while the contact detail page stops passing these props.

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/contacts/ActivityTimeline.tsx
git commit -m "feat: make note props optional in ActivityTimeline"
```

---

## Chunk 6: Final Verification

### Task 9: Build and verify

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 2: Push**

```bash
git push
```
