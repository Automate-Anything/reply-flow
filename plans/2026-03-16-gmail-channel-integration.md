# Gmail Channel Integration — Full Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Reply Flow from a WhatsApp-only inbox into an omnichannel platform supporting WhatsApp and Gmail, with a three-tab inbox (All Channels / WhatsApp / Gmail).

**Architecture:** Six phases, each independently deployable. Phase 1 abstracts the DB and server to be channel-agnostic. Phase 2 adds Gmail backend (OAuth, Pub/Sub, send/receive). Phase 3 de-WhatsApp-ifies all UI copy and API routes. Phase 4 builds the three-tab omnichannel inbox. Phase 5 adds the email composer and email message rendering. Phase 6 adds cross-channel features (contact linking, channel switching, collision detection).

**Tech Stack:** React 19 + TypeScript + Vite, Express 5, Supabase (Postgres + RLS), `googleapis` + `google-auth-library` (Gmail API), `@tiptap/react` + `@tiptap/starter-kit` (rich text editor), `juice` (CSS inlining for email HTML), `nodemailer/lib/mail-composer` (MIME construction).

**Dependencies between phases:**
```
Phase 1 (Channel Abstraction) ──→ Phase 2 (Gmail Backend) ──→ Phase 5 (Email Composer)
         │                                    │
         ├──→ Phase 3 (De-WhatsApp UI)        ├──→ Phase 6 (Cross-Channel)
         │                                    │
         └──→ Phase 4 (Omnichannel Inbox) ────┘
```
Phases 3 and 4 can run in parallel after Phase 1. Phase 5 needs Phase 2. Phase 6 needs Phases 2 + 4.

---

## Phase 1: Channel Abstraction (DB + Server Foundation)

### Goal
Rename `whatsapp_channels` → `channels` with a `channel_type` column. Create a `ChannelProvider` interface so the server dispatches through it instead of calling `whapi.*` directly. All existing WhatsApp functionality MUST continue working identically after this phase.

### File Map

**Database:**
- Create: `supabase/migrations/063_channel_abstraction.sql`

**Server — New files:**
- Create: `server/src/services/channelProvider.ts` — `ChannelProvider` interface + dispatcher
- Create: `server/src/services/providers/whatsapp.ts` — WhatsApp implementation (wraps existing `whapi.ts`)
- Create: `server/src/services/providers/index.ts` — provider registry

**Server — Modified files (table rename `whatsapp_channels` → `channels`):**
- Modify: `server/src/routes/whatsapp.ts` — table references only (keep route paths for now)
- Modify: `server/src/routes/webhook.ts` — table references
- Modify: `server/src/routes/messages.ts` — table references + extract send logic to provider
- Modify: `server/src/routes/billing.ts` — table references
- Modify: `server/src/routes/company.ts` — table references
- Modify: `server/src/routes/access.ts` — table references
- Modify: `server/src/routes/ai.ts` — table references
- Modify: `server/src/routes/contacts.ts` — table references
- Modify: `server/src/routes/seed.ts` — table references
- Modify: `server/src/services/messageProcessor.ts` — table references + extract WhatsApp logic to provider
- Modify: `server/src/services/ai.ts` — table references + use provider for sending
- Modify: `server/src/services/scheduler.ts` — table references + use provider for sending
- Modify: `server/src/services/billingService.ts` — table references
- Modify: `server/src/services/conflictDetection.ts` — table references
- Modify: `server/src/services/permissionResolver.ts` — table references
- Modify: `server/src/services/handoffNotifier.ts` — table references
- Modify: `server/src/services/promptBuilder.ts` — make prompt channel-aware
- Modify: `server/src/types/index.ts` — add `channel_type` to `ChatSession` type
- Modify: `server/src/config/env.ts` — make `WHAPI_*` vars optional

**Client — Modified files (API response shape):**
- Modify: `client/src/hooks/useConversations.ts` — add `channel_type` to Conversation type
- Modify: `client/src/hooks/useContacts.ts` — keep `whatsapp_name`, add `display_name`

---

### Task 1.1: Database Migration — Rename Table + Add `channel_type`

**Files:**
- Create: `supabase/migrations/063_channel_abstraction.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 063_channel_abstraction.sql
-- Rename whatsapp_channels to channels and add channel_type column

-- 1. Rename the table
ALTER TABLE public.whatsapp_channels RENAME TO channels;

-- 2. Add channel_type column with default 'whatsapp' for all existing rows
ALTER TABLE public.channels
  ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'whatsapp';

-- 3. Add display_name column (generic name for any channel - email address, phone, etc.)
ALTER TABLE public.channels
  ADD COLUMN display_identifier TEXT;

-- 4. Backfill display_identifier from phone_number for existing WhatsApp channels
UPDATE public.channels SET display_identifier = phone_number WHERE channel_type = 'whatsapp';

-- 5. Add columns for email channel OAuth tokens (nullable for WhatsApp)
ALTER TABLE public.channels
  ADD COLUMN oauth_access_token TEXT,
  ADD COLUMN oauth_refresh_token TEXT,
  ADD COLUMN oauth_token_expiry TIMESTAMPTZ,
  ADD COLUMN oauth_scopes TEXT[],
  ADD COLUMN gmail_history_id TEXT,
  ADD COLUMN gmail_watch_expiry TIMESTAMPTZ,
  ADD COLUMN email_address TEXT,
  ADD COLUMN email_signature TEXT;

-- 6. Add check constraint for channel_type
ALTER TABLE public.channels
  ADD CONSTRAINT channels_type_check CHECK (channel_type IN ('whatsapp', 'email'));

-- 7. Add index on channel_type for filtering
CREATE INDEX idx_channels_type ON public.channels (channel_type);

-- 8. Add unique constraint for email channels (one email per company)
CREATE UNIQUE INDEX idx_channels_email_company
  ON public.channels (company_id, email_address)
  WHERE channel_type = 'email' AND email_address IS NOT NULL;

-- 9. Drop and recreate RLS policies with new table name
-- (Postgres auto-renames policies when table is renamed, but let's be explicit)
-- The policies already reference the correct table via OID, so they auto-follow the rename.
-- No action needed for RLS policies.

-- 10. Create a backwards-compat view for any raw SQL that might reference old name
-- NOTE: This view is READ-ONLY. No code should INSERT/UPDATE/DELETE via this view.
-- All writes must go through the 'channels' table directly.
CREATE VIEW public.whatsapp_channels AS
  SELECT * FROM public.channels WHERE channel_type = 'whatsapp';
```

- [ ] **Step 2: Verify migration locally**

Run: `source server/.env && pg_dump --schema-only --schema=public "$SUPABASE_DB_URL" | grep -i "channels"` to verify the rename. Confirm the view exists and the `channel_type` column is present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/063_channel_abstraction.sql
git commit -m "feat: rename whatsapp_channels to channels, add channel_type column"
```

---

### Task 1.2: ChannelProvider Interface + WhatsApp Implementation

**Files:**
- Create: `server/src/services/channelProvider.ts`
- Create: `server/src/services/providers/whatsapp.ts`
- Create: `server/src/services/providers/index.ts`

- [ ] **Step 1: Define the ChannelProvider interface**

Create `server/src/services/channelProvider.ts`:

```typescript
// The canonical message shape that all providers normalize to
export interface IncomingMessage {
  id: string;                        // provider's message ID
  chatId: string;                    // normalized chat/thread identifier
  senderIdentifier: string;          // phone number or email address
  senderName: string | null;         // display name from provider
  body: string;                      // extracted text body
  htmlBody?: string;                 // HTML body (email only)
  subject?: string;                  // email subject (email only)
  messageType: string;               // 'text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'email', etc.
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  isFromMe: boolean;
  metadata: Record<string, unknown>; // provider-specific data (link previews, reactions, CC/BCC, etc.)
  media?: {
    url?: string;
    id?: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
  replyTo?: {
    messageId: string;
    body?: string;
  };
  threadId?: string;                 // email thread ID
}

export interface SendMessageResult {
  messageId: string;                 // provider's message ID for the sent message
  threadId?: string;                 // email thread ID (if applicable)
}

export interface ChannelProvider {
  readonly type: 'whatsapp' | 'email';

  // Send a text/html message
  sendMessage(channel: ChannelRecord, chatId: string, body: string, options?: {
    htmlBody?: string;
    subject?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
    cc?: string[];
    bcc?: string[];
    quotedMessageId?: string;
  }): Promise<SendMessageResult>;

  // Normalize a provider-specific webhook payload into IncomingMessage[]
  normalizeWebhookPayload(payload: unknown, channel: ChannelRecord): Promise<IncomingMessage[]>;

  // Normalize a provider-specific status update
  normalizeStatusUpdate?(payload: unknown): Promise<Array<{ messageId: string; status: string }>>;

  // Download media by provider-specific ID (returns null if media not found)
  downloadMedia?(channel: ChannelRecord, mediaId: string): Promise<Buffer | null>;

  // Get contact profile from provider
  getContactProfile?(channel: ChannelRecord, identifier: string): Promise<{
    name?: string;
    avatarUrl?: string;
  } | null>;

  // Provider-specific message actions (WhatsApp only)
  starMessage?(channel: ChannelRecord, messageId: string, star: boolean): Promise<void>;
  pinMessage?(channel: ChannelRecord, messageId: string, pin: boolean): Promise<void>;
  reactToMessage?(channel: ChannelRecord, messageId: string, emoji: string): Promise<void>;
  forwardMessage?(channel: ChannelRecord, messageId: string, targetChatId: string): Promise<unknown>;
}

// The DB row shape for a channel
export interface ChannelRecord {
  id: number;
  company_id: string;
  channel_type: 'whatsapp' | 'email';
  channel_id: string | null;        // external provider ID (whapi channel_id)
  channel_token: string | null;      // whapi token
  channel_name: string | null;
  channel_status: string;
  phone_number: string | null;
  email_address: string | null;
  display_identifier: string | null;
  profile_name: string | null;
  profile_picture_url: string | null;
  webhook_registered: boolean;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_token_expiry: string | null;
  gmail_history_id: string | null;
  gmail_watch_expiry: string | null;
  email_signature: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  workspace_id: string | null;
  // Additional fields may exist from migrations (auto_reply, schedule, etc.)
  // These are passed through but not all providers use them
  [key: string]: unknown;
}
```

- [ ] **Step 2: Create WhatsApp provider (wraps existing whapi.ts)**

Create `server/src/services/providers/whatsapp.ts`:

```typescript
import * as whapi from '../whapi.js';
import type { ChannelProvider, ChannelRecord, IncomingMessage, SendMessageResult } from '../channelProvider.js';
import type { WhapiIncomingMessage, WhapiWebhookPayload, WhapiStatusUpdate } from '../../types/webhook.js';

function normalizeChatId(chatId?: string | null): string | null {
  if (!chatId) return null;
  return chatId.replace(/@.*$/, '');
}

function formatJid(chatId: string): string {
  return chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
}

function extractMessageBody(msg: WhapiIncomingMessage): string {
  // Move existing logic from messageProcessor.ts lines 64-99 here
  if (msg.type === 'text' && msg.text?.body) return msg.text.body;
  if (msg.type === 'link_preview' && msg.link_preview?.body) return msg.link_preview.body;
  if (msg.type === 'image' && msg.image?.caption) return msg.image.caption;
  if (msg.type === 'video' && msg.video?.caption) return msg.video.caption;
  if (msg.type === 'document' && msg.document?.caption) return msg.document.caption;
  if (msg.type === 'audio') return '[Audio message]';
  if (msg.type === 'voice' || msg.type === 'ptt') return '[Voice message]';
  if (msg.type === 'sticker') return '[Sticker]';
  if (msg.type === 'interactive') return msg.interactive?.body?.text || '[Interactive message]';
  if (msg.type === 'reply') {
    return msg.reply?.buttons_reply?.title || msg.reply?.list_reply?.title || '[Reply]';
  }
  if (msg.type === 'action' && msg.action?.type === 'reaction') return '';
  return msg.text?.body || '';
}

export const whatsappProvider: ChannelProvider = {
  type: 'whatsapp',

  async sendMessage(channel, chatId, body, options) {
    const jid = formatJid(chatId);
    const result = await whapi.sendTextMessage(
      channel.channel_token!,
      jid,
      body,
      options?.quotedMessageId || undefined
    );
    const messageId = (result as any)?.message?.id || (result as any)?.message_id || null;
    return { messageId };
  },

  async normalizeWebhookPayload(payload: WhapiWebhookPayload, channel) {
    const messages: IncomingMessage[] = [];
    if (!payload.messages) return messages;

    for (const msg of payload.messages) {
      // Skip group messages
      if (msg.chat_id?.endsWith('@g.us')) continue;

      const isOutbound = msg.from_me === true;
      const normalizedChatId = normalizeChatId(msg.chat_id) || normalizeChatId(msg.from);
      const counterpartyPhone = isOutbound
        ? normalizeChatId(msg.to) || normalizeChatId(msg.chat_id)
        : normalizeChatId(msg.from);

      const mediaPayload = msg.image || msg.document || msg.audio || msg.voice || msg.video || msg.sticker;

      messages.push({
        id: msg.id,
        chatId: normalizedChatId || '',
        senderIdentifier: counterpartyPhone || '',
        senderName: msg.from_name || null,
        body: extractMessageBody(msg),
        messageType: msg.type || 'text',
        direction: isOutbound ? 'outbound' : 'inbound',
        timestamp: new Date((msg.timestamp || 0) * 1000),
        isFromMe: isOutbound,
        metadata: {
          raw: msg,                    // preserve original for WhatsApp-specific processing
          link_preview: msg.link_preview,
          context: msg.context,
          action: msg.action,
        },
        media: mediaPayload ? {
          url: (mediaPayload as any).link,
          id: (mediaPayload as any).id,
          mimeType: (mediaPayload as any).mime_type,
          filename: (mediaPayload as any).filename,
          caption: (mediaPayload as any).caption,
        } : undefined,
        replyTo: msg.context?.quoted_id ? {
          messageId: msg.context.quoted_id,
          body: msg.context?.quoted_content?.body,
        } : undefined,
      });
    }
    return messages;
  },

  async normalizeStatusUpdate(payload: WhapiWebhookPayload) {
    if (!payload.statuses) return [];
    return payload.statuses.map((s: WhapiStatusUpdate) => ({
      messageId: s.id,
      status: s.status,
    }));
  },

  async downloadMedia(channel, mediaId) {
    return whapi.downloadMediaById(channel.channel_token!, mediaId);
  },

  async getContactProfile(channel, identifier) {
    try {
      const profile = await whapi.getContactProfile(channel.channel_token!, identifier);
      return {
        name: profile.name || undefined,
        avatarUrl: profile.icon_full || profile.icon || undefined,
      };
    } catch {
      return null;
    }
  },

  async starMessage(channel, messageId, star) {
    if (star) await whapi.starMessage(channel.channel_token!, messageId);
    else await whapi.unstarMessage(channel.channel_token!, messageId);
  },

  async pinMessage(channel, messageId, pin) {
    if (pin) await whapi.pinMessage(channel.channel_token!, messageId);
    else await whapi.unpinMessage(channel.channel_token!, messageId);
  },

  async reactToMessage(channel, messageId, emoji) {
    await whapi.reactToMessage(channel.channel_token!, messageId, emoji);
  },

  async forwardMessage(channel, messageId, targetChatId) {
    return whapi.forwardMessage(channel.channel_token!, messageId, formatJid(targetChatId));
  },
};
```

- [ ] **Step 3: Create provider registry**

Create `server/src/services/providers/index.ts`:

```typescript
import type { ChannelProvider } from '../channelProvider.js';
import { whatsappProvider } from './whatsapp.js';

const providers: Record<string, ChannelProvider> = {
  whatsapp: whatsappProvider,
  // email: emailProvider — added in Phase 2
};

export function getProvider(channelType: string): ChannelProvider {
  const provider = providers[channelType];
  if (!provider) throw new Error(`No provider registered for channel type: ${channelType}`);
  return provider;
}

export function registerProvider(type: string, provider: ChannelProvider) {
  providers[type] = provider;
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/channelProvider.ts server/src/services/providers/
git commit -m "feat: add ChannelProvider interface and WhatsApp provider implementation"
```

---

### Task 1.3: Rename All `whatsapp_channels` → `channels` in Server Code

This is a systematic find-and-replace across 15 server files. The backwards-compat view means the DB won't break during incremental migration, but we should rename all references in one pass.

**Files:** All 15+ server files listed in Phase 1 File Map above.

- [ ] **Step 1: Rename table references in all route files**

In every file under `server/src/routes/` and `server/src/services/`, replace:
```
.from('whatsapp_channels')  →  .from('channels')
```

Files to update (exact search-and-replace):
- `server/src/routes/whatsapp.ts` (17 occurrences)
- `server/src/routes/messages.ts` (4 occurrences)
- `server/src/routes/webhook.ts` (1 occurrence)
- `server/src/routes/billing.ts` (2 occurrences)
- `server/src/routes/company.ts` (1 occurrence)
- `server/src/routes/access.ts` (1 occurrence)
- `server/src/routes/ai.ts` (1 occurrence)
- `server/src/routes/contacts.ts` (1 occurrence)
- `server/src/routes/seed.ts` (3 occurrences)
- `server/src/routes/contactImportExport.ts` (if any)
- `server/src/services/messageProcessor.ts` (3 occurrences)
- `server/src/services/ai.ts` (2 occurrences)
- `server/src/services/billingService.ts` (1 occurrence)
- `server/src/services/conflictDetection.ts` (1 occurrence)
- `server/src/services/permissionResolver.ts` (4 occurrences)
- `server/src/services/handoffNotifier.ts` (1 occurrence)
- `server/src/services/scheduler.ts` (1 occurrence)

Also in `server/src/routes/billing.ts` line 62, replace:
```typescript
const table = resource === 'channels' ? 'whatsapp_channels' : 'ai_agents';
// →
const table = resource === 'channels' ? 'channels' : 'ai_agents';
```

- [ ] **Step 2: Make WHAPI env vars optional**

In `server/src/config/env.ts`, change:
```typescript
WHAPI_PARTNER_TOKEN: z.string().min(1),
WHAPI_PROJECT_ID: z.string().min(1),
// →
WHAPI_PARTNER_TOKEN: z.string().optional(),
WHAPI_PROJECT_ID: z.string().optional(),
```

- [ ] **Step 3: Add `channel_type` to TypeScript types**

In `server/src/types/index.ts`, add to `ChatSession` interface:
```typescript
channel_type?: 'whatsapp' | 'email';
```

- [ ] **Step 4: Make promptBuilder channel-aware**

In `server/src/services/promptBuilder.ts`:

1. The `DEFAULT_CORE_RULES` constant (line ~123) contains `"You are chatting via WhatsApp."` and `DEFAULT_IDENTITY` (line ~130) contains `"WhatsApp assistant"`. Both are cached strings.

2. Change `DEFAULT_CORE_RULES` from a constant to a function:
```typescript
// Before: const DEFAULT_CORE_RULES = `...You are chatting via WhatsApp...`;
// After:
function getCoreRules(channelType: 'whatsapp' | 'email' = 'whatsapp'): string {
  const channelInstruction = channelType === 'email'
    ? 'You are communicating via email. Use professional formatting with greeting and sign-off.'
    : 'You are chatting via WhatsApp. Keep messages concise and mobile-friendly.';
  return DEFAULT_CORE_RULES_TEMPLATE.replace('{{CHANNEL_INSTRUCTION}}', channelInstruction);
}
```

3. Replace the hardcoded line in `DEFAULT_CORE_RULES` with `{{CHANNEL_INSTRUCTION}}` placeholder, and store the template in `DEFAULT_CORE_RULES_TEMPLATE`.

4. Update `DEFAULT_IDENTITY` similarly:
```typescript
// Replace "WhatsApp assistant" with a generic term like "messaging assistant"
```

5. Add `channelType` parameter to `buildPrompt()` / `buildDefaultCache()` function signatures. The caller already has access to the channel via the session's `channel_id` — look up `channel_type` in the same query.

6. Update `buildDefaultCache()` to call `getCoreRules(channelType)` instead of using the constant directly. The cache key should include `channelType` to avoid stale cached prompts:
```typescript
const cacheKey = `${companyId}:${agentId}:${channelType}`;
```

**Note:** This is more involved than a simple string replacement because of the caching mechanism. Test by verifying that WhatsApp conversations still get "WhatsApp" instructions and email conversations get "email" instructions.

- [ ] **Step 5: Build and verify**

Run: `npm run build` from project root. Fix any TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/ server/src/services/ server/src/types/ server/src/config/env.ts client/src/hooks/useConversations.ts client/src/hooks/useContacts.ts
git commit -m "refactor: rename whatsapp_channels to channels across all server files"
```

---

### Task 1.4: Wire Provider into Message Sending

Replace direct `whapi.*` calls in the three send paths with provider dispatch.

**Files:**
- Modify: `server/src/routes/messages.ts` (lines 42-110)
- Modify: `server/src/services/ai.ts` (lines 854-999)
- Modify: `server/src/services/scheduler.ts` (lines 25-57)

- [ ] **Step 1: Update messages.ts send route**

In `server/src/routes/messages.ts`, replace the send logic (around lines 42-110):

```typescript
import { getProvider } from '../services/providers/index.js';

// Replace the channel lookup to include channel_type:
const { data: channel } = await supabaseAdmin
  .from('channels')
  .select('id, channel_token, channel_type, email_address')
  .eq('id', session.channel_id)
  .eq('channel_status', 'connected')
  .single();

if (!channel) return res.status(400).json({ error: 'No connected channel for this conversation' });

// Replace the whapi.sendTextMessage call:
const provider = getProvider(channel.channel_type);
const result = await provider.sendMessage(channel as any, session.chat_id, body, {
  quotedMessageId: whapiQuotedId,
});
```

- [ ] **Step 2: Update ai.ts send functions**

In `server/src/services/ai.ts`, update `sendOutsideHoursReply()` and `sendAndStoreMessage()` to use the provider:

```typescript
import { getProvider } from './providers/index.js';

// In both functions, replace:
// const chatId = session.chat_id.includes('@') ? session.chat_id : `${session.chat_id}@s.whatsapp.net`;
// const result = await whapi.sendTextMessage(ch.channel_token, chatId, message);
// With:
const provider = getProvider(ch.channel_type || 'whatsapp');
const result = await provider.sendMessage(ch as any, session.chat_id, message);
```

- [ ] **Step 3: Update scheduler.ts**

Same pattern as Step 2 for the scheduled message sending function.

- [ ] **Step 4: Build and verify**

Run: `npm run build` — ensure no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/messages.ts server/src/services/ai.ts server/src/services/scheduler.ts
git commit -m "refactor: use ChannelProvider for all message sending instead of direct whapi calls"
```

---

### Task 1.5: Wire Provider into Webhook Processing

**Files:**
- Modify: `server/src/routes/webhook.ts`
- Modify: `server/src/services/messageProcessor.ts`

- [ ] **Step 1: Update webhook.ts to look up channel_type**

Change the channel lookup (around line 69) to include `channel_type`:

```typescript
const { data: channel } = await supabaseAdmin
  .from('channels')
  .select('id, user_id, company_id, channel_status, phone_number, channel_type')
  .eq('channel_id', whapiChannelId)
  .eq('channel_status', 'connected')
  .single();
```

- [ ] **Step 2: Update contacts.ts query for channel name**

In `server/src/routes/contacts.ts` (around line 1046), update the query that fetches channel names:

```typescript
.from('channels')  // was 'whatsapp_channels'
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev` and verify:
1. Existing WhatsApp channels appear in the channels list
2. Sending a message works
3. Receiving a webhook message works
4. AI responses still fire

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: complete channel abstraction - all existing WhatsApp functionality preserved"
```

---

## Phase 2: Gmail Backend Integration

### Goal
Add Gmail as a channel type: OAuth2 connection flow, Pub/Sub webhook for inbound emails, sending replies with proper threading, attachment handling.

### File Map

**Server — New files:**
- Create: `server/src/services/providers/email.ts` — Gmail ChannelProvider implementation
- Create: `server/src/services/gmail.ts` — Gmail API client (OAuth, watch, history, send)
- Create: `server/src/routes/gmail.ts` — OAuth callback, channel management routes
- Create: `server/src/routes/gmailWebhook.ts` — Pub/Sub push endpoint

**Server — Modified files:**
- Modify: `server/src/index.ts` — register new routes
- Modify: `server/src/config/env.ts` — add Google env vars
- Modify: `server/src/services/providers/index.ts` — register email provider

**New npm packages:**
- `googleapis` — Gmail API client
- `google-auth-library` — OAuth2
- `nodemailer` — MIME construction (only `MailComposer`)
- `juice` — CSS inlining for HTML emails

---

### Task 2.1: Add Google Environment Variables

**Files:**
- Modify: `server/src/config/env.ts`

- [ ] **Step 1: Add Google env vars to Zod schema**

```typescript
// Add to the env schema:
GOOGLE_CLIENT_ID: z.string().optional(),
GOOGLE_CLIENT_SECRET: z.string().optional(),
GOOGLE_REDIRECT_URI: z.string().optional(),
GCP_PROJECT_ID: z.string().optional(),
GOOGLE_PUBSUB_TOPIC: z.string().optional(),
GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().optional(), // shared secret for Pub/Sub webhook auth
```

- [ ] **Step 2: Add to server/.env.example**

```
# Gmail Integration (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
GCP_PROJECT_ID=
GOOGLE_PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/gmail-notifications
GOOGLE_PUBSUB_VERIFICATION_TOKEN=
```

- [ ] **Step 3: Commit**

```bash
git add server/src/config/env.ts server/.env.example
git commit -m "feat: add Google OAuth environment variables"
```

---

### Task 2.2: Gmail API Service

**Files:**
- Create: `server/src/services/gmail.ts`

- [ ] **Step 1: Install dependencies**

Run: `npm --prefix server install googleapis google-auth-library nodemailer juice`
Run: `npm --prefix server install -D @types/nodemailer @types/juice`

- [ ] **Step 2: Create Gmail service**

Create `server/src/services/gmail.ts`:

```typescript
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

// Create a fresh OAuth2 client for a given channel's tokens
// channelId is required when tokens are provided so refreshed tokens can be persisted
export function createOAuth2Client(tokens?: {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}, channelId?: number): OAuth2Client {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
  if (tokens) {
    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });
    // Listen for token refresh events — MUST persist new tokens to DB
    // channelId is required so we know which row to update
    client.on('tokens', async (newTokens) => {
      console.log('[gmail] Token refreshed, persisting to DB');
      try {
        const updateData: Record<string, unknown> = {
          oauth_access_token: newTokens.access_token,
          oauth_token_expiry: newTokens.expiry_date
            ? new Date(newTokens.expiry_date).toISOString()
            : null,
        };
        // Google may also rotate the refresh token
        if (newTokens.refresh_token) {
          updateData.oauth_refresh_token = newTokens.refresh_token;
        }
        // channelId must be captured in closure — see createOAuth2Client signature below
        await supabaseAdmin
          .from('channels')
          .update(updateData)
          .eq('id', channelId);
      } catch (err) {
        console.error('[gmail] Failed to persist refreshed tokens:', err);
      }
    });
  }
  return client;
}

// Generate the OAuth consent URL
export function getAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state, // encode channelId or companyId
  });
}

// Exchange authorization code for tokens
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  email: string;
}> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user's email address
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
    email: data.email!,
  };
}

// Create Gmail API client for a channel
export function getGmailClient(tokens: {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}): gmail_v1.Gmail {
  const client = createOAuth2Client(tokens);
  return google.gmail({ version: 'v1', auth: client });
}

// Register a watch on the user's inbox
export async function registerWatch(gmail: gmail_v1.Gmail): Promise<{
  historyId: string;
  expiration: string;
}> {
  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: env.GOOGLE_PUBSUB_TOPIC,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });
  return {
    historyId: res.data.historyId!,
    expiration: res.data.expiration!,
  };
}

// Fetch new messages since a historyId
export async function getHistoryChanges(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
      pageToken,
    });

    if (res.data.history) {
      for (const h of res.data.history) {
        if (h.messagesAdded) {
          for (const added of h.messagesAdded) {
            if (added.message?.id) {
              messageIds.push(added.message.id);
            }
          }
        }
      }
    }
    latestHistoryId = res.data.historyId || latestHistoryId;
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return { messageIds, newHistoryId: latestHistoryId };
}

// Get a single message with full detail
export async function getMessage(gmail: gmail_v1.Gmail, messageId: string) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

// Parse email headers
export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}

// Extract body from MIME parts (recursive)
export function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string = 'text/html'
): string | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part, mimeType);
      if (result) return result;
    }
  }
  return null;
}

// Extract attachments metadata from MIME parts
export function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> {
  const attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        attachmentId: part.body.attachmentId,
        size: part.body.size || 0,
      });
    }
    // Recurse into nested parts
    attachments.push(...extractAttachments(part));
  }
  return attachments;
}

// Send an email reply (with proper threading headers)
export async function sendReply(
  gmail: gmail_v1.Gmail,
  options: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
    threadId: string;
    inReplyTo: string;
    references: string;
    cc?: string[];
    bcc?: string[];
    signature?: string;
  }
): Promise<{ messageId: string; threadId: string }> {
  // Use nodemailer's MailComposer for proper MIME construction
  const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default;

  const fullHtml = options.signature
    ? `${options.htmlBody}<br/><br/>--<br/>${options.signature}`
    : options.htmlBody;

  const mail = new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject.startsWith('Re:') ? options.subject : `Re: ${options.subject}`,
    inReplyTo: options.inReplyTo,
    references: options.references,
    html: fullHtml,
    text: options.textBody,
  });

  const msg = await mail.compile().build();
  const raw = msg.toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: options.threadId },
  });

  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
  };
}

// Send a new email (not a reply)
export async function sendNew(
  gmail: gmail_v1.Gmail,
  options: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
    cc?: string[];
    bcc?: string[];
    signature?: string;
  }
): Promise<{ messageId: string; threadId: string }> {
  const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default;

  const fullHtml = options.signature
    ? `${options.htmlBody}<br/><br/>--<br/>${options.signature}`
    : options.htmlBody;

  const mail = new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc?.join(', '),
    bcc: options.bcc?.join(', '),
    subject: options.subject,
    html: fullHtml,
    text: options.textBody,
  });

  const msg = await mail.compile().build();
  const raw = msg.toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
  };
}

// Download an attachment
export async function getAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return Buffer.from(res.data.data!, 'base64url');
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/gmail.ts package*.json server/package*.json
git commit -m "feat: add Gmail API service (OAuth, watch, history, send, parse)"
```

---

### Task 2.3: Gmail OAuth Routes

**Files:**
- Create: `server/src/routes/gmail.ts`
- Modify: `server/src/index.ts` — register routes

- [ ] **Step 1: Create Gmail channel management routes**

Create `server/src/routes/gmail.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as gmail from '../services/gmail.js';

const router = Router();
router.use(requireAuth);

// POST /api/gmail/connect — Start OAuth flow
router.post('/connect', requirePermission('channels', 'create'), async (req, res) => {
  try {
    const { channelName } = req.body;
    const companyId = req.user!.company_id;

    // Create a pending email channel
    const { data: channel, error } = await supabaseAdmin
      .from('channels')
      .insert({
        company_id: companyId,
        created_by: req.user!.id,
        channel_type: 'email',
        channel_name: channelName || 'Gmail',
        channel_status: 'pending',
      })
      .select('id')
      .single();

    if (error) throw error;

    // Generate OAuth URL with HMAC-signed state to prevent CSRF
    // The state includes channelId + companyId, signed with the server secret
    const statePayload = JSON.stringify({ channelId: channel.id, companyId, ts: Date.now() });
    const hmac = crypto.createHmac('sha256', env.SESSION_SECRET || env.SUPABASE_SERVICE_KEY!)
      .update(statePayload).digest('hex');
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: hmac })).toString('base64');
    const authUrl = gmail.getAuthUrl(state);

    res.json({ authUrl, channelId: channel.id });
  } catch (err) {
    console.error('[gmail] connect error:', err);
    res.status(500).json({ error: 'Failed to start Gmail connection' });
  }
});

// GET /api/auth/google/callback — OAuth callback (no auth middleware - redirect from Google)
// This is registered separately in index.ts since it doesn't need requireAuth
export async function handleGoogleCallback(req: any, res: any) {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    // Verify HMAC-signed state to prevent CSRF attacks
    const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const expectedSig = crypto.createHmac('sha256', env.SESSION_SECRET || env.SUPABASE_SERVICE_KEY!)
      .update(decoded.payload).digest('hex');
    if (decoded.sig !== expectedSig) {
      return res.status(403).send('Invalid state signature');
    }
    const { channelId, companyId } = JSON.parse(decoded.payload);

    // Verify channel exists, belongs to the claimed company, and is in pending state
    const { data: pendingChannel } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .eq('channel_status', 'pending')
      .single();
    if (!pendingChannel) {
      return res.status(400).send('Invalid or expired channel connection');
    }

    // Exchange code for tokens
    const tokens = await gmail.exchangeCode(code as string);

    // Create Gmail client and register watch
    const gmailClient = gmail.getGmailClient({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    const watchResult = await gmail.registerWatch(gmailClient);

    // Update channel with tokens and email
    await supabaseAdmin
      .from('channels')
      .update({
        email_address: tokens.email,
        display_identifier: tokens.email,
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_token_expiry: new Date(tokens.expiry_date).toISOString(),
        gmail_history_id: watchResult.historyId,
        gmail_watch_expiry: new Date(parseInt(watchResult.expiration)).toISOString(),
        channel_status: 'connected',
        webhook_registered: true,
      })
      .eq('id', channelId);

    // Also create channel_agent_settings (same as WhatsApp flow)
    await supabaseAdmin
      .from('channel_agent_settings')
      .upsert({
        channel_id: channelId,
        company_id: companyId,
        is_enabled: false, // AI off by default for email
      });

    // Redirect back to app
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels/${channelId}?connected=true`);
  } catch (err) {
    console.error('[gmail] callback error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels?error=gmail_connection_failed`);
  }
}

// GET /api/gmail/channels/:id/status — Check connection status
router.get('/channels/:id/status', requirePermission('channels', 'view'), async (req, res) => {
  try {
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('id, channel_status, email_address, gmail_watch_expiry, oauth_token_expiry')
      .eq('id', req.params.id)
      .eq('channel_type', 'email')
      .single();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const watchExpired = channel.gmail_watch_expiry
      ? new Date(channel.gmail_watch_expiry) < new Date()
      : true;

    res.json({
      status: channel.channel_status,
      email: channel.email_address,
      watchActive: !watchExpired,
      tokenExpiry: channel.oauth_token_expiry,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// POST /api/gmail/channels/:id/disconnect
router.post('/channels/:id/disconnect', requirePermission('channels', 'edit'), async (req, res) => {
  try {
    await supabaseAdmin
      .from('channels')
      .update({
        channel_status: 'disconnected',
        oauth_access_token: null,
        oauth_refresh_token: null,
        webhook_registered: false,
      })
      .eq('id', req.params.id)
      .eq('channel_type', 'email');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;
```

- [ ] **Step 2: Register routes in index.ts**

In `server/src/index.ts`:

```typescript
import gmailRouter from './routes/gmail.js';
import { handleGoogleCallback } from './routes/gmail.js';

// Add before auth middleware (callback doesn't need auth):
app.get('/api/auth/google/callback', handleGoogleCallback);

// Add after auth middleware:
app.use('/api/gmail', gmailRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/gmail.ts server/src/index.ts
git commit -m "feat: add Gmail OAuth routes (connect, callback, status, disconnect)"
```

---

### Task 2.4: Gmail Webhook (Pub/Sub Push Endpoint)

**Files:**
- Create: `server/src/routes/gmailWebhook.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create Pub/Sub webhook handler**

Create `server/src/routes/gmailWebhook.ts`:

```typescript
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import * as gmail from '../services/gmail.js';
import { processIncomingMessage } from '../services/messageProcessor.js';
import { getProvider } from '../services/providers/index.js';

const router = Router();

// POST /api/webhooks/gmail — Google Pub/Sub push endpoint
// Verify the Pub/Sub push request is from Google using bearer token
router.post('/', async (req, res) => {
  // Verify Pub/Sub authentication token
  // In production, configure Pub/Sub push subscription with an audience claim
  // and verify the bearer token here. For now, verify the request has the expected structure.
  const authHeader = req.headers.authorization;
  if (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    // Simple shared-secret verification (set in Pub/Sub push config as query param or header)
    const token = req.query.token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (token !== env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
      return res.status(403).send('Forbidden');
    }
  }

  // Acknowledge immediately to prevent Pub/Sub retries
  res.status(200).send('OK');

  try {
    const { message } = req.body;
    if (!message?.data) return;

    // Decode Pub/Sub message
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const { emailAddress, historyId } = data;

    if (!emailAddress || !historyId) return;

    // Look up the channel by email (use maybeSingle in case of duplicates across companies)
    const { data: channels } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('email_address', emailAddress)
      .eq('channel_type', 'email')
      .eq('channel_status', 'connected');

    // Process for each company that has this email connected
    if (!channels || channels.length === 0) {
      console.warn(`[gmail-webhook] No connected channel for ${emailAddress}`);
      return;
    }

    for (const channel of channels) {

    // Skip if this historyId is not newer than what we've processed
    if (channel.gmail_history_id && BigInt(historyId) <= BigInt(channel.gmail_history_id)) {
      continue;
    }

    // Create Gmail client
    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token!,
      refresh_token: channel.oauth_refresh_token!,
    });

    // Fetch history changes since last known historyId
    let changes;
    try {
      changes = await gmail.getHistoryChanges(gmailClient, channel.gmail_history_id || historyId);
    } catch (err: any) {
      if (err.code === 404) {
        // historyId too old — need full sync (skip for now, just update historyId)
        console.warn(`[gmail-webhook] historyId too old for ${emailAddress}, resetting`);
        const profile = await gmailClient.users.getProfile({ userId: 'me' });
        await supabaseAdmin
          .from('channels')
          .update({ gmail_history_id: profile.data.historyId })
          .eq('id', channel.id);
        return;
      }
      throw err;
    }

    // Process each new message
    for (const messageId of changes.messageIds) {
      try {
        const msg = await gmail.getMessage(gmailClient, messageId);
        if (!msg.payload) continue;

        const headers = msg.payload.headers || [];
        const from = gmail.getHeader(headers, 'From');
        const to = gmail.getHeader(headers, 'To');
        const subject = gmail.getHeader(headers, 'Subject');
        const messageIdHeader = gmail.getHeader(headers, 'Message-ID');

        // Determine direction: if From matches our channel email, it's outbound
        const isOutbound = from?.toLowerCase().includes(channel.email_address!.toLowerCase()) || false;

        // Extract sender email (the counterparty)
        const senderEmail = isOutbound
          ? extractEmail(to || '')
          : extractEmail(from || '');

        const senderName = isOutbound
          ? extractName(to || '')
          : extractName(from || '');

        // Extract body
        const htmlBody = gmail.extractBody(msg.payload, 'text/html');
        const textBody = gmail.extractBody(msg.payload, 'text/plain');

        // Extract attachments
        const attachments = gmail.extractAttachments(msg.payload);

        // Build canonical message and process through shared pipeline
        // (processIncomingMessage will be updated to accept the canonical format)
        await processGmailMessage({
          channel,
          gmailMessageId: msg.id!,
          threadId: msg.threadId!,
          from: from || '',
          to: to || '',
          cc: gmail.getHeader(headers, 'Cc') || '',
          bcc: gmail.getHeader(headers, 'Bcc') || '',
          subject: subject || '(no subject)',
          messageIdHeader: messageIdHeader || '',
          inReplyTo: gmail.getHeader(headers, 'In-Reply-To') || '',
          references: gmail.getHeader(headers, 'References') || '',
          htmlBody: htmlBody || textBody || '',
          textBody: textBody || '',
          senderEmail,
          senderName,
          isOutbound,
          timestamp: new Date(parseInt(msg.internalDate || '0')),
          labelIds: msg.labelIds || [],
          attachments,
        });
      } catch (msgErr) {
        console.error(`[gmail-webhook] Error processing message ${messageId}:`, msgErr);
      }
    }

    // Update historyId
    await supabaseAdmin
      .from('channels')
      .update({ gmail_history_id: changes.newHistoryId })
      .eq('id', channel.id);

    } // end for (const channel of channels)
  } catch (err) {
    console.error('[gmail-webhook] Error:', err);
  }
});

// Helper: extract email from "Name <email>" format
function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return match ? match[1] : str.trim();
}

// Helper: extract name from "Name <email>" format
function extractName(str: string): string {
  const match = str.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : '';
}

// Process a single Gmail message through the shared pipeline
async function processGmailMessage(params: {
  channel: ChannelRecord;
  gmailMessageId: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  messageIdHeader: string;
  inReplyTo: string;
  references: string;
  htmlBody: string;
  textBody: string;
  senderEmail: string;
  senderName: string;
  isOutbound: boolean;
  timestamp: Date;
  labelIds: string[];
  attachments: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }>;
}) {
  const {
    channel, gmailMessageId, threadId, subject, senderEmail, senderName,
    isOutbound, timestamp, htmlBody, textBody, from, to, cc, bcc,
    messageIdHeader, inReplyTo, references, attachments,
  } = params;

  // Idempotency: check if message already exists
  const { data: existing } = await supabaseAdmin
    .from('chat_messages')
    .select('id')
    .eq('message_id_normalized', gmailMessageId)
    .single();

  if (existing) return; // Already processed

  // Find or create contact by email
  let contact;
  if (!isOutbound && senderEmail) {
    const { data: existingContact } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, email')
      .eq('company_id', channel.company_id)
      .eq('email', senderEmail)
      .eq('is_deleted', false)
      .single();

    if (existingContact) {
      contact = existingContact;
    } else {
      // Auto-create contact from email
      const { data: newContact } = await supabaseAdmin
        .from('contacts')
        .insert({
          company_id: channel.company_id,
          created_by: channel.created_by,
          email: senderEmail,
          first_name: senderName || senderEmail.split('@')[0],
          phone_number: '', // Email contacts may not have a phone
        })
        .select('id, first_name, last_name, email')
        .single();
      contact = newContact;
    }
  }

  // Find or create session by threadId
  const chatId = threadId; // Gmail threadId is our chat_id for email
  let session;
  const { data: existingSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, contact_id')
    .eq('channel_id', channel.id)
    .eq('chat_id', chatId)
    .single();

  if (existingSession) {
    session = existingSession;
  } else {
    const { data: newSession } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        company_id: channel.company_id,
        user_id: channel.created_by,
        channel_id: channel.id,
        chat_id: chatId,
        phone_number: senderEmail, // Use email in the phone_number field for now
        contact_name: senderName || senderEmail,
        contact_id: contact?.id || null,
        status: 'open',
      })
      .select('id, contact_id')
      .single();
    session = newSession;
  }

  if (!session) return;

  // Store message
  const { data: message } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: session.id,
      company_id: channel.company_id,
      chat_id_normalized: chatId,
      phone_number: senderEmail,
      message_body: textBody || htmlBody?.replace(/<[^>]*>/g, '') || '',
      message_type: 'email',
      message_id_normalized: gmailMessageId,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender_type: isOutbound ? 'human' : 'contact',
      status: 'delivered',
      metadata: {
        subject,
        from,
        to,
        cc,
        bcc,
        message_id_header: messageIdHeader,
        in_reply_to: inReplyTo,
        references,
        html_body: htmlBody,
        attachments: attachments.map(a => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          attachmentId: a.attachmentId,
        })),
      },
      message_ts: timestamp.toISOString(),
    })
    .select('id')
    .single();

  // Update session metadata
  await supabaseAdmin
    .from('chat_sessions')
    .update({
      last_message: `${subject}: ${(textBody || '').substring(0, 100)}`,
      last_message_at: timestamp.toISOString(),
      last_message_direction: isOutbound ? 'outbound' : 'inbound',
      last_message_sender: isOutbound ? 'human' : 'contact',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);
}

export default router;
```

- [ ] **Step 2: Register webhook in index.ts**

In `server/src/index.ts`:

```typescript
import gmailWebhookRouter from './routes/gmailWebhook.js';

// Add alongside the WhatsApp webhook (no auth):
app.use('/api/webhooks/gmail', gmailWebhookRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/gmailWebhook.ts server/src/index.ts
git commit -m "feat: add Gmail Pub/Sub webhook handler for inbound emails"
```

---

### Task 2.5: Email ChannelProvider Implementation

**Files:**
- Create: `server/src/services/providers/email.ts`
- Modify: `server/src/services/providers/index.ts`

- [ ] **Step 1: Create email provider**

Create `server/src/services/providers/email.ts`:

```typescript
import type { ChannelProvider, ChannelRecord, IncomingMessage, SendMessageResult } from '../channelProvider.js';
import * as gmail from '../gmail.js';
import juice from 'juice';

export const emailProvider: ChannelProvider = {
  type: 'email',

  async sendMessage(channel, chatId, body, options) {
    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token!,
      refresh_token: channel.oauth_refresh_token!,
    });

    // Inline CSS for email compatibility
    const htmlBody = juice(body);

    if (options?.threadId && options?.inReplyTo) {
      // Reply to existing thread
      const result = await gmail.sendReply(gmailClient, {
        to: chatId, // chatId is the recipient email for email channels
        from: channel.email_address!,
        subject: options.subject || '',
        htmlBody,
        threadId: options.threadId,
        inReplyTo: options.inReplyTo,
        references: options.references || '',
        cc: options.cc,
        bcc: options.bcc,
        signature: channel.email_signature || undefined,
      });
      return { messageId: result.messageId, threadId: result.threadId };
    } else {
      // New email
      const result = await gmail.sendNew(gmailClient, {
        to: chatId,
        from: channel.email_address!,
        subject: options?.subject || '',
        htmlBody,
        cc: options?.cc,
        bcc: options?.bcc,
        signature: channel.email_signature || undefined,
      });
      return { messageId: result.messageId, threadId: result.threadId };
    }
  },

  // Webhook normalization is handled directly in gmailWebhook.ts
  // since Gmail push only sends historyId, not actual messages
  async normalizeWebhookPayload() {
    return []; // Not used — Gmail webhook handler processes directly
  },

  async downloadMedia(channel, attachmentId) {
    // attachmentId format: "messageId:attachmentId"
    const [messageId, attId] = attachmentId.split(':');
    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token!,
      refresh_token: channel.oauth_refresh_token!,
    });
    return gmail.getAttachment(gmailClient, messageId, attId);
  },

  async getContactProfile() {
    // Email doesn't have profile pictures like WhatsApp
    return null;
  },
};
```

- [ ] **Step 2: Register in provider index**

In `server/src/services/providers/index.ts`:

```typescript
import { emailProvider } from './email.js';

// Add to the providers map:
const providers: Record<string, ChannelProvider> = {
  whatsapp: whatsappProvider,
  email: emailProvider,
};
```

- [ ] **Step 3: Install juice**

Run: `npm --prefix server install juice`

- [ ] **Step 4: Commit**

```bash
git add server/src/services/providers/email.ts server/src/services/providers/index.ts server/package*.json
git commit -m "feat: add email ChannelProvider implementation with Gmail send/receive"
```

---

### Task 2.6: Gmail Watch Renewal Cron

**Files:**
- Create: `server/src/services/gmailWatchCron.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create cron service**

Create `server/src/services/gmailWatchCron.ts`:

```typescript
import { supabaseAdmin } from '../config/supabase.js';
import * as gmail from './gmail.js';

// Renew watch() for all connected Gmail channels every 6 hours
export function startGmailWatchCron() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  async function renewAll() {
    try {
      const { data: channels } = await supabaseAdmin
        .from('channels')
        .select('id, email_address, oauth_access_token, oauth_refresh_token')
        .eq('channel_type', 'email')
        .eq('channel_status', 'connected');

      if (!channels?.length) return;

      for (const ch of channels) {
        try {
          const client = gmail.getGmailClient({
            access_token: ch.oauth_access_token!,
            refresh_token: ch.oauth_refresh_token!,
          });
          const result = await gmail.registerWatch(client);
          await supabaseAdmin
            .from('channels')
            .update({
              gmail_history_id: result.historyId,
              gmail_watch_expiry: new Date(parseInt(result.expiration)).toISOString(),
            })
            .eq('id', ch.id);
          console.log(`[gmail-cron] Renewed watch for ${ch.email_address}`);
        } catch (err) {
          console.error(`[gmail-cron] Failed to renew watch for ${ch.email_address}:`, err);
          // If token is revoked, mark channel as disconnected
          if ((err as any)?.code === 401 || (err as any)?.message?.includes('invalid_grant')) {
            await supabaseAdmin
              .from('channels')
              .update({ channel_status: 'disconnected' })
              .eq('id', ch.id);
          }
        }
      }
    } catch (err) {
      console.error('[gmail-cron] Error:', err);
    }
  }

  // Run immediately on startup, then every 6 hours
  renewAll();
  setInterval(renewAll, SIX_HOURS);
}
```

- [ ] **Step 2: Start cron on server boot**

In `server/src/index.ts`, after the server starts:

```typescript
import { startGmailWatchCron } from './services/gmailWatchCron.js';

// After app.listen():
if (env.GOOGLE_CLIENT_ID) {
  startGmailWatchCron();
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/gmailWatchCron.ts server/src/index.ts
git commit -m "feat: add Gmail watch() renewal cron (every 6 hours)"
```

---

## Phase 3: De-WhatsApp-ify UI Copy & API Routes

### Goal
Remove all "WhatsApp" hardcoded text from the UI. Rename `/api/whatsapp/*` routes to `/api/channels/*`. Update all client API calls. After this phase, the UI is channel-neutral.

### File Map

**Client — Copy changes (28 strings across 12 files):**
- Modify: `client/src/pages/AuthPage.tsx`
- Modify: `client/src/pages/DashboardPage.tsx`
- Modify: `client/src/pages/ChannelsPage.tsx`
- Modify: `client/src/pages/BillingPage.tsx`
- Modify: `client/src/components/settings/BillingTab.tsx`
- Modify: `client/src/components/settings/UsageTab.tsx`
- Modify: `client/src/components/layout/BillingBanners.tsx`
- Modify: `client/src/components/inbox/ContactPanel.tsx`
- Modify: `client/src/components/contacts/ContactDetail.tsx`
- Modify: `client/src/components/settings/ChannelDetailView.tsx`
- Modify: `client/src/components/settings/WhatsAppConnection.tsx` (rename file)
- Modify: `client/src/components/settings/ConversationSettingsTab.tsx`

**Client — Icon changes (5 files):**
- Modify: `client/src/components/layout/Sidebar.tsx`
- Modify: `client/src/pages/AIAgentsPage.tsx`
- Modify: `client/src/pages/RolePermissionsPage.tsx`

**Client — API route changes (6 files):**
- Modify: `client/src/pages/ChannelsPage.tsx`
- Modify: `client/src/hooks/useDashboardData.ts`
- Modify: `client/src/components/settings/AutoAssignSettings.tsx`
- Modify: `client/src/components/settings/ChannelDetailView.tsx`
- Modify: `client/src/components/settings/WhatsAppConnection.tsx`

**Server — Route rename:**
- Modify: `server/src/index.ts` — change `/api/whatsapp` to `/api/channels/whatsapp`
- Keep: `server/src/routes/whatsapp.ts` — file stays (WhatsApp-specific management)

---

### Task 3.1: Rename API Routes (Server + Client)

- [ ] **Step 1: Update server route mounts**

In `server/src/index.ts`, change:
```typescript
app.use('/api/whatsapp/webhook', webhookLimiter, webhookRouter);
app.use('/api/whatsapp', whatsappRouter);
// →
app.use('/api/channels/whatsapp/webhook', webhookLimiter, webhookRouter);
app.use('/api/channels/whatsapp', whatsappRouter);
```

- [ ] **Step 2: Update all client API calls**

Systematic find-and-replace in client/src/:
```
/whatsapp/channels  →  /channels/whatsapp/channels
/whatsapp/health-check  →  /channels/whatsapp/health-check
/whatsapp/create-channel  →  /channels/whatsapp/create-channel
/whatsapp/create-qr  →  /channels/whatsapp/create-qr
/whatsapp/delete-channel  →  /channels/whatsapp/delete-channel
/whatsapp/cancel-provisioning  →  /channels/whatsapp/cancel-provisioning
/whatsapp/logout  →  /channels/whatsapp/logout
```

Files: `ChannelsPage.tsx`, `useDashboardData.ts`, `AutoAssignSettings.tsx`, `ChannelDetailView.tsx`, `WhatsAppConnection.tsx`

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts client/src/pages/ChannelsPage.tsx client/src/hooks/useDashboardData.ts client/src/components/settings/AutoAssignSettings.tsx client/src/components/settings/ChannelDetailView.tsx client/src/components/settings/WhatsAppConnection.tsx
git commit -m "refactor: rename /api/whatsapp/* routes to /api/channels/whatsapp/*"
```

---

### Task 3.2: Replace All "WhatsApp" UI Text

- [ ] **Step 1: Systematic copy replacements**

| File | Old Text | New Text |
|------|----------|----------|
| `AuthPage.tsx` | "WhatsApp business inbox powered by AI" | "Business inbox powered by AI" |
| `DashboardPage.tsx` | "what's happening with your WhatsApp inbox today" | "what's happening in your inbox today" |
| `DashboardPage.tsx` | "WhatsApp Channels" | "Connected Channels" |
| `ChannelsPage.tsx` | "Connect and manage your WhatsApp lines" | "Connect and manage your channels" |
| `ChannelsPage.tsx` | "Create a new WhatsApp channel below" | "Connect a new channel" |
| `BillingPage.tsx` | "WhatsApp channel" | "channel" |
| `BillingTab.tsx` | "WhatsApp channel" (x2) | "channel" |
| `BillingTab.tsx` | "Trial limits: 1 WhatsApp channel" | "Trial limits: 1 channel" |
| `UsageTab.tsx` | `label="WhatsApp Channels"` | `label="Channels"` |
| `BillingBanners.tsx` | "AI agent and WhatsApp service" | "AI agent and messaging service" |
| `ContactPanel.tsx` | "WhatsApp Name" | "Display Name" |
| `ContactDetail.tsx` | `label="WhatsApp"` | `label="Display Name"` |
| `ConversationSettingsTab.tsx` | "unknown phone number" | "unknown sender" |
| `ChannelDetailView.tsx` | "WhatsApp connected successfully" (x4) | "Channel connected successfully" |
| `ChannelDetailView.tsx` | "WhatsApp disconnected" | "Channel disconnected" |
| `ChannelDetailView.tsx` | "This WhatsApp channel is no longer connected" | "This channel is no longer connected" |

- [ ] **Step 2: Replace Smartphone icon with generic icon**

In these files, replace `Smartphone` with `Cable` (or `Radio`):
- `client/src/components/layout/Sidebar.tsx` — nav icon
- `client/src/pages/AIAgentsPage.tsx` — channel indicator
- `client/src/pages/RolePermissionsPage.tsx` — permission category icon

Keep `Smartphone` in `WhatsAppConnection.tsx` and `ChannelsPage.tsx` channel items (will be made conditional in Phase 4).

- [ ] **Step 3: Build and verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ client/src/components/settings/ client/src/components/layout/Sidebar.tsx client/src/components/inbox/ContactPanel.tsx client/src/components/contacts/ContactDetail.tsx
git commit -m "refactor: replace all WhatsApp-specific UI text with generic channel terminology"
```

---

### Task 3.3: Update Contact Identity Model

**Files:**
- Modify: `client/src/components/contacts/ContactForm.tsx`
- Modify: `client/src/components/contacts/ImportWizard.tsx`
- Modify: `supabase/migrations/064_contact_email_identifier.sql`

- [ ] **Step 1: Create migration to make phone_number nullable**

Create `supabase/migrations/064_contact_email_identifier.sql`:

```sql
-- Allow contacts without phone numbers (email-only contacts)
ALTER TABLE public.contacts ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN phone_number SET DEFAULT '';

-- Add display_name column (populated from whatsapp_name, email From header, etc.)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill display_name from whatsapp_name
UPDATE public.contacts SET display_name = whatsapp_name WHERE whatsapp_name IS NOT NULL AND display_name IS NULL;

-- Adjust unique constraint: allow (company_id, email) uniqueness for email-only contacts
-- The existing (company_id, phone_number) constraint handles phone-based contacts
CREATE UNIQUE INDEX idx_contacts_company_email_unique
  ON public.contacts (company_id, email)
  WHERE email IS NOT NULL AND email != '' AND is_deleted = false AND (phone_number IS NULL OR phone_number = '');
```

- [ ] **Step 2: Update ContactForm validation**

In `client/src/components/contacts/ContactForm.tsx`, change phone validation (around line 140):
```typescript
// Old: phone_number is required
// New: at least one of phone_number or email is required
if (!formData.phone_number && !formData.email) {
  toast.error('At least one of Phone or Email is required');
  return;
}
```

- [ ] **Step 3: Update ImportWizard**

In `client/src/components/contacts/ImportWizard.tsx`, change the phone requirement (around line 223):
```typescript
// Old: const phoneIsMapped = Object.values(mappings).includes('phone_number');
// New:
const phoneIsMapped = Object.values(mappings).includes('phone_number');
const emailIsMapped = Object.values(mappings).includes('email');
const hasIdentifier = phoneIsMapped || emailIsMapped;
// Use hasIdentifier instead of phoneIsMapped for the validation check
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/064_contact_email_identifier.sql client/src/components/contacts/ContactForm.tsx client/src/components/contacts/ImportWizard.tsx
git commit -m "feat: make phone_number optional, allow email-only contacts"
```

---

## Phase 4: Omnichannel Inbox UI

### Goal
Add the three-tab inbox system (All Channels / WhatsApp / Gmail). Add channel icons to conversation items. Add channel filter support.

### File Map

- Modify: `client/src/pages/InboxPage.tsx` — add channel tabs above status tabs
- Modify: `client/src/components/inbox/ConversationList.tsx` — accept channel filter
- Modify: `client/src/components/inbox/ConversationItem.tsx` — add channel icon
- Modify: `client/src/components/inbox/ConversationHeader.tsx` — add channel badge
- Modify: `client/src/hooks/useConversations.ts` — add `channel_type` filter parameter
- Create: `client/src/lib/channelTypes.ts` — channel type utilities (icons, labels, etc.)

---

### Task 4.1: Channel Type Utilities

**Files:**
- Create: `client/src/lib/channelTypes.ts`

- [ ] **Step 1: Create channel type helper**

```typescript
import { Smartphone, Mail, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ChannelType = 'whatsapp' | 'email';

interface ChannelTypeConfig {
  label: string;
  icon: LucideIcon;
  color: string;        // tailwind text color class
  bgColor: string;      // tailwind bg color class
}

export const CHANNEL_TYPES: Record<ChannelType, ChannelTypeConfig> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: Smartphone,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  email: {
    label: 'Gmail',
    icon: Mail,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
};

export function getChannelConfig(type: string | null | undefined): ChannelTypeConfig {
  return CHANNEL_TYPES[type as ChannelType] || {
    label: 'Unknown',
    icon: MessageSquare,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/channelTypes.ts
git commit -m "feat: add channel type utilities (icons, labels, colors)"
```

---

### Task 4.2: Add Channel Tabs to Inbox

**Files:**
- Modify: `client/src/pages/InboxPage.tsx`
- Modify: `client/src/hooks/useConversations.ts`

- [ ] **Step 1: Add `channel_type` to the Conversation interface and server response**

In `client/src/hooks/useConversations.ts`:
1. Add `channel_type?: string` to the `Conversation` interface (around line 16)
2. Add `channel_type?: 'whatsapp' | 'email'` to the `ConversationFilters` interface
3. In the fetch function, pass it as a query param:
```typescript
if (filters?.channel_type) params.set('channel_type', filters.channel_type);
```

In `server/src/routes/conversations.ts`:
1. Update the select query to include channel data via a Supabase nested select:
```typescript
// Change the existing select to include channel info:
// Before: .select('*, contact:contact_id(...)')
// After:  .select('*, contact:contact_id(...), channel:channel_id(channel_type, channel_name)')
```
2. Map `channel_type` into the response:
```typescript
// In the response mapping, add:
channel_type: session.channel?.channel_type || 'whatsapp',
```

- [ ] **Step 2: Add server-side channel_type filter**

In `server/src/routes/conversations.ts`, in the list endpoint, filter using the nested relationship:
```typescript
if (req.query.channel_type) {
  // Use Supabase's nested filter syntax on the joined channels table
  // This requires the select to include the channel relationship (Step 1 above)
  query = query.eq('channel:channel_id.channel_type', req.query.channel_type);
}
```

**Note:** If the Supabase PostgREST nested filter doesn't work as expected, the alternative is to add a denormalized `channel_type` column to `chat_sessions` directly:
```sql
-- Fallback: add to migration 063
ALTER TABLE public.chat_sessions ADD COLUMN channel_type TEXT DEFAULT 'whatsapp';
UPDATE public.chat_sessions s SET channel_type = c.channel_type
  FROM public.channels c WHERE s.channel_id = c.id;
```
Then filter directly: `query = query.eq('channel_type', req.query.channel_type);`

- [ ] **Step 3: Derive `connectedChannelTypes` from the channels list**

The channel tabs should only show tabs for channel types the company has connected. Fetch this from the existing channels endpoint:

```typescript
// In InboxPage.tsx, fetch connected channel types:
const [connectedChannelTypes, setConnectedChannelTypes] = useState<string[]>([]);
useEffect(() => {
  // Reuse the existing channels endpoint (currently at /channels/whatsapp/channels)
  // After Phase 3 route rename, this becomes /channels/whatsapp/channels
  // We need a unified endpoint — add GET /api/channels/types to conversations.ts or a new route:
  api.get('/conversations/channel-types')
    .then(res => setConnectedChannelTypes(res.data))
    .catch(() => setConnectedChannelTypes(['whatsapp'])); // fallback
}, []);
```

On the server, add a lightweight endpoint in `server/src/routes/conversations.ts`:
```typescript
// GET /api/conversations/channel-types — distinct channel types for this company
router.get('/channel-types', requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('channels')
    .select('channel_type')
    .eq('company_id', req.user!.company_id)
    .eq('channel_status', 'connected');
  const types = [...new Set((data || []).map(c => c.channel_type))];
  res.json(types);
});
```

Only render tab buttons for types present in `connectedChannelTypes` (plus always show "All").

- [ ] **Step 4: Add channel tabs to InboxPage**

In `client/src/pages/InboxPage.tsx`, add primary channel tabs above the existing status tabs:

```typescript
import { getChannelConfig, CHANNEL_TYPES } from '@/lib/channelTypes';

// Add state:
const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'email'>('all');

// Add to the effectiveFilters:
if (channelFilter !== 'all') {
  filters.channel_type = channelFilter;
}

// Render channel tabs above status tabs:
<div className="flex border-b px-2 gap-1">
  <button
    className={cn('px-3 py-1.5 text-sm font-medium rounded-t',
      channelFilter === 'all' ? 'bg-background border-b-2 border-primary' : 'text-muted-foreground'
    )}
    onClick={() => setChannelFilter('all')}
  >
    All Channels
  </button>
  {connectedChannelTypes.map(type => {
    const config = getChannelConfig(type);
    const Icon = config.icon;
    return (
      <button
        key={type}
        className={cn('px-3 py-1.5 text-sm font-medium rounded-t flex items-center gap-1.5',
          channelFilter === type ? 'bg-background border-b-2 border-primary' : 'text-muted-foreground'
        )}
        onClick={() => setChannelFilter(type)}
      >
        <Icon className="h-3.5 w-3.5" />
        {config.label}
      </button>
    );
  })}
</div>
```

The `connectedChannelTypes` should be derived from the channels the company has connected (fetch from `/api/channels/whatsapp/channels` or a new unified endpoint).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/InboxPage.tsx client/src/hooks/useConversations.ts server/src/routes/conversations.ts
git commit -m "feat: add channel tabs to inbox (All Channels / WhatsApp / Gmail)"
```

---

### Task 4.3: Channel Icons on Conversation Items

**Files:**
- Modify: `client/src/components/inbox/ConversationItem.tsx`

- [ ] **Step 1: Add channel icon to conversation items**

In `ConversationItem.tsx`, add a small channel icon before the contact name. The icon should only show when `channelFilter === 'all'` (redundant in channel-specific tabs):

```typescript
import { getChannelConfig } from '@/lib/channelTypes';

// Inside the component, derive channel type from the conversation:
const channelConfig = getChannelConfig(conversation.channel_type);
const ChannelIcon = channelConfig.icon;

// In the render, before the contact name:
{showChannelIcon && (
  <ChannelIcon className={cn('h-3.5 w-3.5 shrink-0', channelConfig.color)} />
)}
```

- [ ] **Step 2: Update ConversationHeader**

In `ConversationHeader.tsx`, add channel badge next to contact info:

```typescript
// Below contact name:
<span className="text-xs text-muted-foreground flex items-center gap-1">
  <ChannelIcon className="h-3 w-3" />
  {channelConfig.label} via {channelName}
</span>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/ConversationItem.tsx client/src/components/inbox/ConversationHeader.tsx
git commit -m "feat: add channel icons to conversation list items and headers"
```

---

### Task 4.4: Channel-Aware Channels Page

**Files:**
- Modify: `client/src/pages/ChannelsPage.tsx`

- [ ] **Step 1: Update ChannelsPage to show both channel types**

Fetch from both WhatsApp and Gmail endpoints. Display channel type icon and label per item. Add a "Connect" button that opens a type picker (WhatsApp QR vs Gmail OAuth).

```typescript
// Channel list now shows mixed types:
{channels.map(ch => {
  const config = getChannelConfig(ch.channel_type);
  const Icon = config.icon;
  return (
    <div key={ch.id} className="flex items-center gap-3 p-4 border rounded-lg">
      <Icon className={cn('h-5 w-5', config.color)} />
      <div>
        <p className="font-medium">{ch.channel_name || ch.display_identifier}</p>
        <p className="text-sm text-muted-foreground">
          {ch.display_identifier} · {config.label} · {ch.channel_status}
        </p>
      </div>
    </div>
  );
})}
```

- [ ] **Step 2: Add channel type picker for "Connect" button**

```typescript
// "Connect" opens a dialog:
<Dialog>
  <DialogContent>
    <DialogTitle>Connect a Channel</DialogTitle>
    <div className="space-y-3">
      <button onClick={startWhatsAppFlow}>
        <Smartphone /> WhatsApp — Scan QR code to connect
      </button>
      <button onClick={startGmailFlow}>
        <Mail /> Gmail — Connect your Google account
      </button>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ChannelsPage.tsx
git commit -m "feat: update Channels page for multi-channel (WhatsApp + Gmail type picker)"
```

---

## Phase 5: Email Composer & Message Rendering

### Goal
Add rich text email composer (Tiptap), email message rendering (full-width cards with headers), and adaptive message thread that switches between chat mode and email mode based on channel type.

### File Map

- Create: `client/src/components/inbox/EmailComposer.tsx` — Tiptap rich text editor with CC/BCC/Subject
- Create: `client/src/components/inbox/EmailMessageCard.tsx` — email message display (From/To/CC, subject, HTML body, attachments)
- Modify: `client/src/components/inbox/MessageThread.tsx` — conditional rendering (chat vs email mode)
- Modify: `client/src/components/inbox/MessageBubble.tsx` — hide WhatsApp-only features for email
- Modify: `client/src/components/inbox/MessageInput.tsx` — route to EmailComposer for email channels

**New npm packages (client):**
- `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`
- `@tiptap/extension-link`, `@tiptap/extension-underline`, `@tiptap/extension-placeholder`

---

### Task 5.1: Install Tiptap

- [ ] **Step 1: Install packages**

Run: `npm --prefix client install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-underline @tiptap/extension-placeholder dompurify`
Run: `npm --prefix client install -D @types/dompurify`

- [ ] **Step 2: Commit**

```bash
git add client/package*.json
git commit -m "chore: install Tiptap rich text editor packages"
```

---

### Task 5.2: Email Message Card Component

**Files:**
- Create: `client/src/components/inbox/EmailMessageCard.tsx`

- [ ] **Step 1: Create email message display component**

```typescript
import { Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useState } from 'react';
import type { Message } from '@/hooks/useMessages';

interface EmailMessageCardProps {
  message: Message;
  isExpanded?: boolean;
}

export default function EmailMessageCard({ message, isExpanded: defaultExpanded = true }: EmailMessageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const metadata = message.metadata as any;

  const from = metadata?.from || '';
  const to = metadata?.to || '';
  const cc = metadata?.cc || '';
  const subject = metadata?.subject || '(no subject)';
  const htmlBody = metadata?.html_body || '';
  const attachments = metadata?.attachments || [];

  return (
    <div className="border rounded-lg bg-card mb-3 overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-4 py-3 text-left hover:bg-muted/50 flex items-start justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {message.direction === 'outbound' ? 'You' : from}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(message.message_ts || message.created_at).toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            To: {to}
            {cc && <> · CC: {cc}</>}
          </div>
          {!expanded && (
            <p className="text-sm text-muted-foreground truncate mt-1">
              {message.message_body?.substring(0, 120)}
            </p>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 mt-1" /> : <ChevronDown className="h-4 w-4 shrink-0 mt-1" />}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 border-t">
          {/* Subject */}
          <div className="py-2 text-sm font-medium">{subject}</div>

          {/* HTML Body */}
          <div
            className="prose prose-sm max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlBody, { FORBID_TAGS: ['style', 'script'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] }) }}
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t space-y-1">
              {attachments.map((att: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{att.filename}</span>
                  <span className="text-xs">({Math.round(att.size / 1024)} KB)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/inbox/EmailMessageCard.tsx
git commit -m "feat: add EmailMessageCard component for email message display"
```

---

### Task 5.3: Email Composer Component

**Files:**
- Create: `client/src/components/inbox/EmailComposer.tsx`

- [ ] **Step 1: Create email composer with Tiptap**

```typescript
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, List, ListOrdered, Quote, Send, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EmailComposerProps {
  to: string;
  subject: string;
  signature?: string;
  onSend: (data: {
    htmlBody: string;
    textBody: string;
    subject: string;
    cc: string[];
    bcc: string[];
  }) => void;
  sending?: boolean;
  replyMode?: boolean; // true = replying (subject locked), false = new email
}

export default function EmailComposer({
  to, subject: initialSubject, signature, onSend, sending, replyMode = true
}: EmailComposerProps) {
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Compose your reply...' }),
    ],
    content: signature ? `<p></p><br/><p>--</p>${signature}` : '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[120px] px-3 py-2',
      },
    },
  });

  const handleSend = () => {
    if (!editor) return;
    onSend({
      htmlBody: editor.getHTML(),
      textBody: editor.getText(),
      subject,
      cc: cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : [],
      bcc: bcc ? bcc.split(',').map(s => s.trim()).filter(Boolean) : [],
    });
  };

  if (!editor) return null;

  return (
    <div className="border-t bg-background">
      {/* Recipients */}
      <div className="px-3 py-2 border-b space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-8">To:</span>
          <span className="font-medium">{to}</span>
          <div className="ml-auto flex gap-2">
            {!showCc && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>CC</button>}
            {!showBcc && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowBcc(true)}>BCC</button>}
          </div>
        </div>
        {showCc && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-8">CC:</span>
            <Input value={cc} onChange={e => setCc(e.target.value)} placeholder="email@example.com" className="h-7 text-sm" />
          </div>
        )}
        {showBcc && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-8">BCC:</span>
            <Input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="email@example.com" className="h-7 text-sm" />
          </div>
        )}
        {!replyMode && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-8">Subj:</span>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className="h-7 text-sm" />
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="px-3 py-1 border-b flex items-center gap-0.5">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')}><UnderlineIcon className="h-3.5 w-3.5" /></ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}><List className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}><Quote className="h-3.5 w-3.5" /></ToolbarButton>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      {/* Actions */}
      <div className="px-3 py-2 border-t flex items-center justify-between">
        <Button variant="ghost" size="sm"><Paperclip className="h-4 w-4 mr-1" /> Attach</Button>
        <Button size="sm" onClick={handleSend} disabled={sending}>
          <Send className="h-4 w-4 mr-1" /> Send
        </Button>
      </div>
    </div>
  );
}

function ToolbarButton({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-muted ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/inbox/EmailComposer.tsx
git commit -m "feat: add EmailComposer with Tiptap rich text editor, CC/BCC, subject"
```

---

### Task 5.4: Adaptive Message Thread

**Files:**
- Modify: `client/src/components/inbox/MessageThread.tsx`
- Modify: `client/src/components/inbox/MessageInput.tsx`

- [ ] **Step 1: Add channel-type-aware rendering to MessageThread**

In `MessageThread.tsx`, detect the channel type and render either `MessageBubble` (WhatsApp) or `EmailMessageCard` (email):

```typescript
import EmailMessageCard from './EmailMessageCard';

// In the message rendering loop:
{messages.map(msg => (
  channelType === 'email'
    ? <EmailMessageCard key={msg.id} message={msg} />
    : <MessageBubble key={msg.id} message={msg} /* ...existing props */ />
))}
```

- [ ] **Step 2: Swap composer based on channel type**

In the bottom of `MessageThread` or `InboxPage`, conditionally render:

```typescript
{channelType === 'email'
  ? <EmailComposer
      to={contactEmail}
      subject={threadSubject}
      signature={channelSignature}
      onSend={handleEmailSend}
    />
  : <MessageInput /* ...existing props */ />
}
```

- [ ] **Step 3: Add email send handler**

In the parent component, add:

```typescript
const handleEmailSend = async (data) => {
  await api.post('/api/messages/send-email', {
    sessionId: activeSession.id,
    htmlBody: data.htmlBody,
    textBody: data.textBody,
    subject: data.subject,
    cc: data.cc,
    bcc: data.bcc,
  });
};
```

- [ ] **Step 4: Add server endpoint for email sending**

In `server/src/routes/messages.ts`, add a `/send-email` route that uses the email provider:

```typescript
router.post('/send-email', requireAuth, async (req, res) => {
  const { sessionId, htmlBody, textBody, subject, cc, bcc } = req.body;
  // Look up session → channel → use email provider to send
  // Store message in chat_messages with metadata
  // Similar to existing /send but for email
});
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/inbox/MessageThread.tsx client/src/components/inbox/MessageInput.tsx client/src/pages/InboxPage.tsx
git commit -m "feat: adaptive message thread - chat bubbles for WhatsApp, email cards for Gmail"
```

---

## Phase 6: Cross-Channel Features

### Goal
Add contact auto-linking across channels, "Other Conversations" sidebar in contact panel, and collision detection ("Sarah is replying...").

### File Map

- Modify: `client/src/components/inbox/ContactPanel.tsx` — add "Active On" and "Other Conversations" sections
- Create: `server/src/routes/contactChannels.ts` — API to fetch a contact's cross-channel conversations
- Modify: `client/src/components/inbox/ConversationHeader.tsx` — add collision detection indicator

---

### Task 6.1: Cross-Channel Contact Panel

**Files:**
- Modify: `client/src/components/inbox/ContactPanel.tsx`
- Create: `server/src/routes/contactChannels.ts`

- [ ] **Step 1: Add endpoint to fetch contact's conversations across channels**

This endpoint already partially exists (`GET /contacts/:id/messages`). Extend or add a new endpoint:

```typescript
// GET /api/contacts/:id/conversations — all sessions for a contact
router.get('/:contactId/conversations', requireAuth, requirePermission('contacts', 'view'), async (req, res) => {
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, channel_id, chat_id, status, last_message, last_message_at, channels(channel_type, channel_name, display_identifier)')
    .eq('contact_id', req.params.contactId)
    .eq('company_id', req.user!.company_id)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false });

  res.json(sessions || []);
});
```

- [ ] **Step 2: Add "Other Conversations" to ContactPanel**

In `ContactPanel.tsx`, add a new section showing all conversations for the current contact:

```typescript
// Fetch cross-channel conversations using the project's data-fetching pattern:
const [otherConversations, setOtherConversations] = useState<any[]>([]);
useEffect(() => {
  if (!contact?.id) return;
  api.get(`/contacts/${contact.id}/conversations`)
    .then(res => setOtherConversations(res.data))
    .catch(err => console.error('Failed to fetch cross-channel conversations:', err));
}, [contact?.id]);

// Render:
<div className="space-y-1">
  <h4 className="text-xs font-medium text-muted-foreground">Other Conversations</h4>
  {otherConversations?.filter(c => c.id !== currentSessionId).map(conv => {
    const config = getChannelConfig(conv.channels?.channel_type);
    const Icon = config.icon;
    return (
      <button key={conv.id} onClick={() => navigateToConversation(conv.id)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm">
        <Icon className={cn('h-3.5 w-3.5', config.color)} />
        <span className="truncate">{conv.last_message}</span>
        <span className="text-xs text-muted-foreground ml-auto">{conv.status}</span>
      </button>
    );
  })}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/ContactPanel.tsx server/src/routes/contactChannels.ts server/src/routes/contacts.ts
git commit -m "feat: add cross-channel conversation list to contact panel"
```

---

### Task 6.2: Contact Auto-Linking

**Note:** Basic auto-linking by email is already implemented in Phase 2's `processGmailMessage` function — it queries `contacts.email = senderEmail` before creating a new contact. This task extends that with **name-based fuzzy matching** for cases where the email field on the WhatsApp contact is not populated.

**Files:**
- Modify: `server/src/routes/gmailWebhook.ts` — add fallback name-based matching

- [ ] **Step 1: Add fallback name-based contact matching**

In `processGmailMessage`, after the existing email lookup fails and before creating a new contact, add a name-based fallback:

```typescript
// Existing: exact email match (already in Phase 2 code)
// Fallback: if sender name matches an existing contact's name, suggest linking
if (!contact && senderName) {
  const { data: nameMatches } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, last_name, email, phone_number')
    .eq('company_id', channel.company_id)
    .eq('is_deleted', false)
    .or(`first_name.ilike.%${senderName.split(' ')[0]}%`)
    .limit(1);

  if (nameMatches && nameMatches.length === 1 && !nameMatches[0].email) {
    // Auto-fill their email field for future matching
    await supabaseAdmin
      .from('contacts')
      .update({ email: senderEmail })
      .eq('id', nameMatches[0].id);
    contact = nameMatches[0];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/gmailWebhook.ts
git commit -m "feat: add name-based fallback for cross-channel contact auto-linking"
```

---

### Task 6.3: Gmail Connection UI Component

**Files:**
- Create: `client/src/components/settings/GmailConnection.tsx`
- Modify: `client/src/pages/ChannelsPage.tsx` — render GmailConnection when user picks Gmail

- [ ] **Step 1: Create GmailConnection component**

```typescript
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import api from '@/lib/api';

interface GmailConnectionProps {
  onCreated: () => void;
}

export default function GmailConnection({ onCreated }: GmailConnectionProps) {
  const [channelName, setChannelName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/channels/gmail/connect', {
        channelName: channelName || 'Gmail',
      });
      // Redirect to Google OAuth consent screen
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('Failed to start Gmail connection:', err);
      setLoading(false);
    }
  };

  return (
    <div className="border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
          <Mail className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-medium">Connect Gmail</h3>
          <p className="text-sm text-muted-foreground">
            Sign in with Google to connect your inbox
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Channel Name (optional)</label>
        <Input
          value={channelName}
          onChange={e => setChannelName(e.target.value)}
          placeholder="e.g., Support Inbox"
        />
      </div>

      <Button onClick={handleConnect} disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
        Sign in with Google
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into ChannelsPage**

Update the channel type picker dialog to render `GmailConnection` when email is selected and `WhatsAppConnection` when WhatsApp is selected.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/GmailConnection.tsx client/src/pages/ChannelsPage.tsx
git commit -m "feat: add Gmail connection UI component with OAuth flow"
```

---

### Task 6.4: Gmail Channel Detail View

**Files:**
- Modify: `client/src/components/settings/ChannelDetailView.tsx`

- [ ] **Step 1: Make Connection tab conditional on channel type**

In `ChannelDetailView.tsx`, the Connection tab content should check `channel.channel_type`:

```typescript
{channel.channel_type === 'whatsapp' ? (
  // Existing WhatsApp connection UI (QR code, phone, etc.)
  <WhatsAppConnectionTab channel={channel} />
) : channel.channel_type === 'email' ? (
  // Email connection UI
  <div className="space-y-4">
    <div className="flex items-center gap-3">
      <Mail className="h-5 w-5 text-blue-600" />
      <div>
        <p className="font-medium">{channel.email_address}</p>
        <p className="text-sm text-muted-foreground">
          Last synced: {channel.gmail_watch_expiry ? formatDistanceToNow(new Date(channel.gmail_watch_expiry)) : 'Unknown'}
        </p>
      </div>
    </div>

    {/* Signature editor */}
    <div className="space-y-2">
      <label className="text-sm font-medium">Email Signature</label>
      <textarea
        className="w-full border rounded p-2 text-sm min-h-[100px]"
        value={signature}
        onChange={e => setSignature(e.target.value)}
        placeholder="Your signature..."
      />
      <Button size="sm" onClick={saveSignature}>Save Signature</Button>
    </div>

    <div className="flex gap-2">
      <Button variant="outline" onClick={handleReauth}>Re-authenticate</Button>
      <Button variant="destructive" onClick={handleDisconnect}>Disconnect</Button>
    </div>
  </div>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/ChannelDetailView.tsx
git commit -m "feat: channel-type-aware detail view (WhatsApp QR vs Gmail OAuth)"
```

---

## Verification Checklist

After all phases are complete, verify:

- [ ] Existing WhatsApp channels still connect, send, and receive messages
- [ ] Gmail OAuth flow connects successfully
- [ ] Inbound emails appear in the inbox under the Gmail tab
- [ ] Outbound email replies have correct threading (show in same thread in recipient's Gmail)
- [ ] Three inbox tabs work correctly with proper filtering
- [ ] Channel icons appear on conversation items in "All Channels" tab
- [ ] Email composer shows rich text toolbar, CC/BCC, subject
- [ ] Email messages render as full-width cards (not chat bubbles)
- [ ] Contact panel shows "Other Conversations" across channels
- [ ] Email contacts auto-link to existing WhatsApp contacts by email match
- [ ] Channels page shows both WhatsApp and Gmail channels
- [ ] Channel detail view adapts to channel type
- [ ] Billing counts channels generically (not "WhatsApp channels")
- [ ] AI agent responds to emails with appropriate formatting
- [ ] Gmail watch() renewals run on schedule
