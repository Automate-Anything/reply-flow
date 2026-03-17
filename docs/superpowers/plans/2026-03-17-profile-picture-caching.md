# Profile Picture Caching Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache WhatsApp profile pictures in a public Supabase Storage bucket so they never expire.

**Architecture:** Download profile pictures from Whapi CDN to a public `profile-pictures` Supabase Storage bucket. Store the public URL in the database. Detect changes by comparing the original CDN URL stored in a new `profile_picture_source_url` column.

**Tech Stack:** Express, Supabase (Storage + PostgREST), axios, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-17-profile-picture-caching-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/065_profile_picture_caching.sql` | Create | Migration: add columns, create bucket, add policies |
| `server/src/services/profilePictureStorage.ts` | Create | Download from CDN → upload to public bucket → return public URL |
| `server/src/services/messageProcessor.ts` | Modify (lines 789-824) | Update `fetchAndStoreProfilePicture` to use new storage service |
| `server/src/routes/conversations.ts` | Modify (lines 244-248) | Pass `companyId` to updated `fetchAndStoreProfilePicture` |
| `server/src/routes/whatsapp.ts` | Modify (lines 11-40) | Update `syncConnectedChannelMetadata` to cache channel profile pics |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/065_profile_picture_caching.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add source URL columns for change detection
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_source_url TEXT;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS profile_picture_source_url TEXT;

-- Create public storage bucket for profile pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read profile pictures (they are public WhatsApp avatars)
CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'profile-pictures');

-- Allow service role to upload/overwrite profile pictures
CREATE POLICY "Service role upload"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'profile-pictures');

CREATE POLICY "Service role overwrite"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'profile-pictures');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/065_profile_picture_caching.sql
git commit -m "feat: add migration for profile picture caching bucket and columns"
```

---

## Task 2: Profile Picture Storage Service

**Files:**
- Create: `server/src/services/profilePictureStorage.ts`

This is a small, focused module that handles downloading from a CDN URL and uploading to the public `profile-pictures` bucket.

- [ ] **Step 1: Create the storage service**

```typescript
import axios from 'axios';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const BUCKET = 'profile-pictures';

/**
 * Downloads an image from a CDN URL and uploads it to the public
 * profile-pictures bucket in Supabase Storage.
 *
 * Returns the full public URL on success, or null on failure.
 */
export async function cacheProfilePicture(
  cdnUrl: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const response = await axios.get(cdnUrl, {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });

    const buffer = Buffer.from(response.data);

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Profile picture upload error:', error.message);
      return null;
    }

    return `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  } catch (err) {
    console.error('Profile picture cache error:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix server` (or `npx tsc --noEmit --project server/tsconfig.json`)
Expected: No errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/profilePictureStorage.ts
git commit -m "feat: add profilePictureStorage service for caching to public bucket"
```

---

## Task 3: Update `fetchAndStoreProfilePicture` in messageProcessor.ts

**Files:**
- Modify: `server/src/services/messageProcessor.ts` (lines 789-824)

- [ ] **Step 1: Update the function**

Replace the existing `fetchAndStoreProfilePicture` function (lines 789-824) with:

```typescript
export async function fetchAndStoreProfilePicture(
  contactId: string,
  phoneNumber: string,
  channelId: number,
  companyId: string,
): Promise<void> {
  // Check if we already have a cached picture and it's fresh (< 7 days)
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('profile_picture_source_url, updated_at')
    .eq('id', contactId)
    .single();

  if (contact?.profile_picture_source_url) {
    const updatedAt = new Date(contact.updated_at).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (updatedAt > sevenDaysAgo) return;
  }

  // Fetch channel token
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', channelId)
    .single();

  if (!channel?.channel_token) return;

  // Fetch profile from Whapi
  const profile = await getContactProfile(channel.channel_token, phoneNumber);
  if (!profile) return;

  const cdnUrl = profile.icon_full || profile.icon || null;
  if (!cdnUrl) return;

  // Skip if CDN URL hasn't changed (same picture)
  if (cdnUrl === contact?.profile_picture_source_url) return;

  // Download and cache to Supabase Storage
  const storagePath = `${companyId}/${contactId}.jpg`;
  const publicUrl = await cacheProfilePicture(cdnUrl, storagePath);
  if (!publicUrl) return;

  // Update contact with public URL and source URL for change detection
  await supabaseAdmin
    .from('contacts')
    .update({
      profile_picture_url: publicUrl,
      profile_picture_source_url: cdnUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
}
```

Add the import at the top of the file (with the other service imports):

```typescript
import { cacheProfilePicture } from './profilePictureStorage.js';
```

- [ ] **Step 2: Update the caller in processIncomingMessage (line 327)**

The existing call passes 3 arguments. Add `companyId` as the 4th:

```typescript
// Before:
fetchAndStoreProfilePicture(contactId, phoneNumber, channelId).catch((err) => {
// After:
fetchAndStoreProfilePicture(contactId, phoneNumber, channelId, companyId).catch((err) => {
```

The `companyId` variable is already available in `processIncomingMessage` scope.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/messageProcessor.ts
git commit -m "feat: cache contact profile pictures to Supabase Storage"
```

---

## Task 4: Update Background Fetch in conversations.ts

**Files:**
- Modify: `server/src/routes/conversations.ts` (lines 244-248)

- [ ] **Step 1: Pass companyId to fetchAndStoreProfilePicture**

The background fetch at lines 244-248 currently calls:
```typescript
fetchAndStoreProfilePicture(s.contact_id!, s.phone_number, s.channel_id!)
```

Update to pass `companyId` (already available as `req.companyId!` in scope):
```typescript
fetchAndStoreProfilePicture(s.contact_id!, s.phone_number, s.channel_id!, companyId)
```

Where `companyId` is `req.companyId!` (already declared earlier in the handler).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/conversations.ts
git commit -m "feat: pass companyId to profile picture caching in conversations endpoint"
```

---

## Task 5: Update Channel Profile Picture Caching in whatsapp.ts

**Files:**
- Modify: `server/src/routes/whatsapp.ts` (lines 11-40, `syncConnectedChannelMetadata`)

- [ ] **Step 1: Add import**

Add at the top of `whatsapp.ts` with other imports:
```typescript
import { cacheProfilePicture } from '../services/profilePictureStorage.js';
```

- [ ] **Step 2: Update syncConnectedChannelMetadata**

Replace the function (lines 11-40) with:

```typescript
async function syncConnectedChannelMetadata(
  companyId: string,
  channelId: number,
  channelToken: string,
  phone: string | null,
  whapiChannelId?: string
) {
  const userProfile = await whapi.getUserProfile(channelToken);
  const cdnUrl = userProfile?.icon_full || userProfile?.icon || null;
  const profileName = userProfile?.name || null;

  // Try health phone → user profile phone → manager API phone
  let resolvedPhone = phone || userProfile?.phone || null;
  if (!resolvedPhone && whapiChannelId) {
    resolvedPhone = await whapi.getChannelPhone(whapiChannelId);
  }

  // Cache profile picture to Supabase Storage if we have a CDN URL
  let profilePictureUrl: string | null = null;
  if (cdnUrl) {
    // Check if CDN URL changed
    const { data: existing } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('profile_picture_source_url')
      .eq('id', channelId)
      .single();

    if (cdnUrl !== existing?.profile_picture_source_url) {
      const storagePath = `channels/${companyId}/${channelId}.jpg`;
      profilePictureUrl = await cacheProfilePicture(cdnUrl, storagePath);
    }
  }

  const updatePayload: Record<string, unknown> = {
    channel_status: 'connected',
    phone_number: resolvedPhone,
    profile_name: profileName,
    updated_at: new Date().toISOString(),
  };

  // Only update picture fields if we have a new cached URL
  if (profilePictureUrl) {
    updatePayload.profile_picture_url = profilePictureUrl;
    updatePayload.profile_picture_source_url = cdnUrl;
  }

  await supabaseAdmin
    .from('whatsapp_channels')
    .update(updatePayload)
    .eq('id', channelId)
    .eq('company_id', companyId);

  return { profilePictureUrl, profileName };
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/whatsapp.ts
git commit -m "feat: cache channel profile pictures to Supabase Storage"
```

---

## Task 6: Run Migration & End-to-End Verification

- [ ] **Step 1: Run the migration against Supabase**

The migration file is `supabase/migrations/065_profile_picture_caching.sql`. Ask the user for permission before executing.

- [ ] **Step 2: Full build check**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Manual verification**

1. Start dev server: `npm run dev`
2. Open inbox at `http://localhost:5174/inbox`
3. Send a test message from a WhatsApp contact
4. Check server logs for absence of "Profile picture cache error" or "Profile picture upload error" messages
5. Check Supabase Storage dashboard → `profile-pictures` bucket should have the image
6. Verify the contact's avatar loads in the inbox (no 403, no broken image)
7. Check `contacts` table → `profile_picture_url` should be a Supabase public URL, `profile_picture_source_url` should be the original CDN URL

- [ ] **Step 4: Final commit (if any cleanup needed)**
