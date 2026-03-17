# Profile Picture Caching Design

**Date:** 2026-03-17
**Status:** Approved

## Problem

Contact and channel profile pictures are stored as direct Whapi/Meta CDN URLs in the database. These URLs are signed and time-limited — once expired, they return 403 Forbidden, causing broken images in the inbox. The Radix Avatar fallback (initial letter) hides the failure, but users see degraded UI with no profile pictures.

## Solution

Download profile pictures to Supabase Storage when they are first fetched from Whapi. Store the storage path in the database instead of the CDN URL. Serve via signed URLs at read time. Detect profile picture changes by comparing the original CDN URL on subsequent fetches.

## Data Model Changes

### `contacts` table

| Column | Type | Change | Purpose |
|--------|------|--------|---------|
| `profile_picture_url` | `TEXT` | Meaning changes | Now stores a Supabase Storage path (e.g., `profile-pictures/{companyId}/{contactId}.jpg`) instead of a CDN URL |
| `profile_picture_source_url` | `TEXT` | **New column** | Stores the original Whapi CDN URL, used to detect when a contact changes their profile picture |

### `whatsapp_channels` table

Same pattern — `profile_picture_url` changes from CDN URL to storage path. Add `profile_picture_source_url` column.

### Storage

No new Supabase Storage bucket. Reuse the existing `chat-media` bucket with a `profile-pictures/` path prefix.

Storage path format: `profile-pictures/{companyId}/{contactId}.{ext}` for contacts, `profile-pictures/channels/{channelId}.{ext}` for channels.

## Server-Side Changes

### `fetchAndStoreProfilePicture` (messageProcessor.ts)

Modified flow:

1. Fetch profile from Whapi via `getContactProfile()` (unchanged)
2. Extract CDN URL (`icon_full` preferred, fallback to `icon`)
3. Read `profile_picture_source_url` from DB for this contact
4. If CDN URL matches `profile_picture_source_url` → skip (picture unchanged)
5. If different or new:
   a. Download image bytes from CDN URL
   b. Upload to Supabase Storage at `profile-pictures/{companyId}/{contactId}.{ext}`
   c. Update DB: set `profile_picture_url` = storage path, `profile_picture_source_url` = CDN URL

### Conversations & Contacts API routes

When returning `profile_picture_url` to the client, generate a signed URL from the storage path using `getSignedUrl()` from `mediaStorage.ts`. This mirrors existing message media serving.

### Channel metadata sync (whatsapp.ts)

Same pattern as contacts — download channel profile picture to storage when syncing metadata via `syncConnectedChannelMetadata`.

## Client-Side Changes

**None.** The client already receives `profile_picture_url` as a URL string and renders it via `<AvatarImage>`. The URL now points to Supabase Storage instead of Meta CDN. Radix Avatar fallback to initials continues to work unchanged.

## Migration Strategy

No bulk data migration needed. Existing contacts have stale CDN URLs in `profile_picture_url`. These will be naturally replaced the next time `fetchAndStoreProfilePicture` runs for each contact (triggered on next inbound message or by the background fetch in the conversations endpoint). Until refreshed, expired URLs show the initial-letter fallback — the same behavior as today.

## Error Handling

- If CDN download fails (network error, 403, etc.), keep the existing `profile_picture_url` as-is. Do not clear it — it may still work or will fallback to initials.
- If Supabase Storage upload fails, log the error and skip. The next fetch cycle will retry.
- Silent failures in `fetchAndStoreProfilePicture` are acceptable — this is a background enhancement, not a critical path.

## Performance

- No impact on page loads — profile picture fetch is already async/fire-and-forget
- Signed URL generation adds negligible overhead to API responses (Supabase SDK call)
- Storage cost is minimal — profile pictures are typically 10-50KB each
- The 7-day re-fetch throttle in `fetchAndStoreProfilePicture` limits unnecessary downloads
