# Profile Picture Caching Design

**Date:** 2026-03-17
**Status:** Implemented

## Problem

Contact and channel profile pictures are stored as direct Whapi/Meta CDN URLs in the database. These URLs are signed and time-limited — once expired, they return 403 Forbidden, causing broken images in the inbox. The Radix Avatar fallback (initial letter) hides the failure, but users see degraded UI with no profile pictures.

## Solution

Download profile pictures to a **public** Supabase Storage bucket when they are first fetched from Whapi. Store the public URL in the database instead of the CDN URL. Detect profile picture changes by comparing the original CDN URL on subsequent fetches.

## Data Model Changes

### `contacts` table

| Column | Type | Change | Purpose |
|--------|------|--------|---------|
| `profile_picture_url` | `TEXT` | Meaning changes | Now stores the **public Supabase Storage URL** instead of a CDN URL |
| `profile_picture_source_url` | `TEXT` | **New column** | Stores the original Whapi CDN URL, used to detect when a contact changes their profile picture |

### `whatsapp_channels` table

Same pattern — `profile_picture_url` changes from CDN URL to public storage URL. Add `profile_picture_source_url` column.

### Storage

**New public bucket: `profile-pictures`**. Profile pictures are not sensitive data — they are WhatsApp avatars visible to anyone with the contact's phone number. A public bucket means URLs never expire, eliminating the core problem. This also avoids needing signed URL generation across the 7+ API surfaces that return `profile_picture_url`.

Storage path format:
- Contacts: `{companyId}/{contactId}.jpg`
- Channels: `channels/{companyId}/{channelId}.jpg`

Use a fixed `.jpg` extension — WhatsApp profile pictures are nearly always JPEG. This avoids orphaned files when re-uploading with a different format.

## Server-Side Changes

### `fetchAndStoreProfilePicture` (messageProcessor.ts)

Modified flow:

1. Fetch profile from Whapi via `getContactProfile()` (unchanged)
2. Extract CDN URL (`icon_full` preferred, fallback to `icon`)
3. Read `profile_picture_source_url` from DB for this contact
4. If CDN URL matches `profile_picture_source_url` → skip (picture unchanged)
5. If different or new:
   a. Download image bytes from CDN URL
   b. Upload to `profile-pictures` bucket at `{companyId}/{contactId}.jpg` with `upsert: true` (overwrites previous picture)
   c. Construct the public URL: `{SUPABASE_URL}/storage/v1/object/public/profile-pictures/{companyId}/{contactId}.jpg`
   d. Update DB: set `profile_picture_url` = public URL, `profile_picture_source_url` = CDN URL

Function signature has `companyId` added as 4th parameter. Both call sites pass it:
- `processIncomingMessage` (messageProcessor.ts)
- Background fetch in `GET /conversations` (conversations.ts)

Upload sets `contentType: 'image/jpeg'` explicitly to ensure browsers render the file as an image.

### Conversations & Contacts API routes

**No changes needed.** Since `profile_picture_url` now stores a public URL (not a storage path), all API surfaces that return this field work unchanged:
- `GET /conversations` (list) — via Supabase join
- `GET /conversations/:id` (detail) — via Supabase join
- `PATCH /conversations/:id` (update response) — via Supabase join
- `GET /contacts/:id` (individual contact) — via `select('*')`
- `GET /contacts` (list) — via `select('*')`
- `GET /whatsapp/channels` and `GET /whatsapp/channels/:id` — for channel pictures

### Channel metadata sync (whatsapp.ts)

Same pattern as contacts — `syncConnectedChannelMetadata` now:

1. Fetches profile from Whapi via `getUserProfile()` (unchanged)
2. Extracts CDN URL from response
3. Compares to `profile_picture_source_url` in `whatsapp_channels` table
4. If different: downloads, uploads to `channels/{companyId}/{channelId}.jpg` with `upsert: true`, stores public URL
5. Only updates `profile_picture_url` and `profile_picture_source_url` in DB when a new cached URL is produced

Also applies to the health-check re-sync path.

## Client-Side Changes

**None.** The client already receives `profile_picture_url` as a URL string and renders it via `<AvatarImage>`. The URL now points to Supabase Storage instead of Meta CDN. Radix Avatar fallback to initials continues to work unchanged.

## Migration

### Schema migration

- Add `profile_picture_source_url TEXT` column to `contacts` and `whatsapp_channels` tables
- Create `profile-pictures` public storage bucket:
  ```sql
  INSERT INTO storage.buckets (id, name, public) VALUES ('profile-pictures', 'profile-pictures', true);
  CREATE POLICY "Public read access" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'profile-pictures');
  CREATE POLICY "Service role upload" ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'profile-pictures');
  CREATE POLICY "Service role overwrite" ON storage.objects FOR UPDATE TO service_role USING (bucket_id = 'profile-pictures');
  ```

### Data migration

No bulk data migration needed. Existing contacts have stale CDN URLs in `profile_picture_url`. These will be naturally replaced the next time `fetchAndStoreProfilePicture` runs for each contact (triggered on next inbound message or by the background fetch in the conversations endpoint). Until refreshed, expired URLs show the initial-letter fallback — the same behavior as today.

## Error Handling

- If CDN download fails (network error, 403, etc.), keep the existing `profile_picture_url` as-is. Do not clear it — it may still work or will fallback to initials.
- If Supabase Storage upload fails, log the error and skip. The next fetch cycle will retry.
- Silent failures in `fetchAndStoreProfilePicture` are acceptable — this is a background enhancement, not a critical path.
- Concurrent fetches for the same contact (two messages arrive simultaneously) are safe due to `upsert: true`. The second upload overwrites with an identical image — wasteful but harmless.

## Performance

- No impact on page loads — profile picture fetch is already async/fire-and-forget
- No signed URL generation needed — public URLs are permanent and free to construct
- Storage cost is minimal — profile pictures are typically 10-50KB each
- The 7-day re-fetch throttle in `fetchAndStoreProfilePicture` limits unnecessary downloads
