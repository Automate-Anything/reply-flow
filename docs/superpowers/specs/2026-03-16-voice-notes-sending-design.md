# Voice Notes — Outbound Sending

**Date:** 2026-03-16
**Status:** Draft
**Scope:** Enable staff/human agents to record and send voice notes to WhatsApp contacts from the inbox UI.

---

## Context

Reply Flow already handles **inbound** voice messages end-to-end: WhatsApp voice messages are received via Whapi webhook, stored in the `chat-media` Supabase bucket, transcribed via OpenAI Whisper, and played back with a waveform player in `MessageBubble.tsx`.

What's missing is the **outbound** side — letting human agents record voice notes in the browser and send them to contacts via WhatsApp.

## Requirements

- **Who sends:** Human agents only (not AI agents)
- **Who receives:** WhatsApp contacts (outbound through inbox UI)
- **Mobile UX (touch):** Hold mic button to record → release to send. Swipe up to lock into a control bar (delete, pause, send)
- **Desktop UX (pointer):** Click mic button → control bar appears (delete, pause, send). No hold-to-send.
- **Live waveform:** Animated waveform visualization displayed during recording
- **Max duration:** 15 minutes
- **Transcription:** Async after sending, stored in `media_transcript` for search/AI context
- **Audio format:** Record in whatever format the browser supports natively, convert server-side to OGG/Opus via ffmpeg before sending to WhatsApp
- **Permissions:** Reuses existing `messages.create` permission
- **Plan gating:** Mic button must be gated behind `PlanGate` (consistent with existing send button)

---

## Architecture

### Approach

Fully client-side recording using the native `MediaRecorder` API + `Web Audio API` for live waveform. Raw audio uploaded to server, converted to OGG/Opus via ffmpeg, stored in Supabase, then sent to WhatsApp via Whapi.

### Why This Approach

- Maximum browser compatibility — no polyfills needed
- Full control over recording UX (critical for hold/swipe/lock interactions)
- Server-side ffmpeg is battle-tested for format conversion
- Reuses existing `mediaStorage.storeBuffer()`, `extractAudioTranscript()`, and Whapi send pipeline

---

## Frontend Design

### New Components

#### `VoiceRecordButton`

- **Location:** Rendered in `MessageInput.tsx`, visible when text input is empty, wrapped in `PlanGate`
- **Behavior:** Detects device type (touch vs pointer) to switch interaction mode
  - Touch: `onTouchStart` begins recording, `onTouchEnd` sends or locks based on swipe gesture
  - Pointer: `onClick` begins recording and shows control bar
- **Swipe-up threshold:** 60px vertical distance from touch start point qualifies as a "swipe up to lock" gesture. Horizontal tolerance of ±30px.

#### `VoiceRecordingBar`

- **Location:** Replaces the message input area while recording is active
- **Contents:** Live waveform canvas, elapsed timer, delete button, pause/resume button, send button
- **Mobile appearance:** Shows when user swipes up to lock recording
- **Desktop appearance:** Shows immediately on click

#### `useVoiceRecorder` Hook

Encapsulates all recording logic:

- **State:** `idle | recording | paused`
- **Methods:** `start()`, `stop()`, `pause()`, `resume()`, `cancel()`
- **Exposed data:** `audioBlob`, `duration`, `analyserNode` (for waveform), `state`, `error`
- **Duration tracking:** Client-side via elapsed time between start/pause/resume events. Sent to server alongside the audio blob.
- **Responsibilities:**
  - Request mic permission via `navigator.mediaDevices.getUserMedia()`
  - Create `MediaRecorder` on the `MediaStream`
  - Create `AudioContext` + `AnalyserNode` on the same stream for live waveform data
  - Enforce 15-minute max duration (auto-stop + trigger send)
  - Handle errors (permission denied, no mic, recorder failure)
  - Clean up streams and audio context on unmount

### Interaction Flows

**Mobile (touch device):**

```
[Hold mic] → recording starts, waveform shows inline
  ├── [Release without swiping] → sends immediately
  ├── [Swipe up + release] → locks into VoiceRecordingBar
  │     ├── [Tap send] → sends
  │     ├── [Tap delete] → discards, returns to normal input
  │     └── [Tap pause] → pauses recording, tap again to resume
  └── [15 min reached] → auto-stop, trigger send
```

**Desktop (pointer device):**

```
[Click mic] → recording starts, VoiceRecordingBar appears
  ├── [Click send] → sends
  ├── [Click delete] → discards, returns to normal input
  ├── [Click pause] → pauses, click again to resume
  └── [15 min reached] → auto-stop, trigger send
```

### Live Waveform Visualization

- Taps the `MediaStream` into an `AnalyserNode` via `useVoiceRecorder`
- `<canvas>` element in `VoiceRecordingBar` renders amplitude bars at ~30fps using `requestAnimationFrame`
- When paused, waveform freezes in place
- Visual style matches the existing playback waveform in `MessageBubble` for consistency

---

## Backend Design

### New API Endpoint

**`POST /api/messages/send-voice`** in `server/src/routes/messages.ts`

- **Auth:** `requirePermission('messages', 'create')`
- **Middleware:** `multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('audio')` — uses memory storage consistent with existing upload routes in this codebase. 25MB limit covers 15 min of uncompressed browser audio.
- **Validation:** Zod schema for non-file fields: `sessionId` (UUID string), `duration` (positive number, max 900)
- **Input:** `multipart/form-data`
  - `audio` — raw audio file (any browser-native format: WebM, MP4, OGG, etc.)
  - `sessionId` — the chat session to send to
  - `duration` — recording duration in seconds (from client)
- **Processing:**
  1. Validate file exists and size is within limit
  2. Generate message UUID server-side (`crypto.randomUUID()`) before any DB insert — used for both storage path and row insert
  3. Write buffer to temp file, convert: `ffmpeg -i input -c:a libopus -b:a 64k output.ogg`
  4. Upload to Supabase: `mediaStorage.storeBuffer()` with path `{company_id}/{channel_id}/{message_id}.ogg`
  5. Insert `chat_messages` row:
     - `id: generated UUID`
     - `message_type: 'voice'`
     - `message_body: '[Voice message M:SS]'` (formatted from duration)
     - `direction: 'outbound'`
     - `sender_type: 'human'`
     - `status: 'sent'` (or `'failed'` if Whapi send fails)
     - `media_storage_path`, `media_mime_type: 'audio/ogg'`
     - `metadata: { duration_seconds: number }`
  6. Update `chat_sessions` — use the **exact same update query pattern** as the text send route in `messages.ts`, including:
     - `last_message: '[Voice message]'` (intentionally shorter than the `message_body` format `[Voice message M:SS]` — session list shows simpler text)
     - `last_message_at: now()`
     - `last_message_direction: 'outbound'`
     - `last_message_sender: 'human'`
     - `updated_at: now()`
     - `draft_message: null`
     - `marked_unread: false`
     - `last_read_at: now()`
     - Race-condition guard: `.or('last_message_at.is.null,last_message_at.lte.${now}')` to prevent older messages from overwriting newer ones
     - Mark all inbound messages as read
  7. Send OGG file to WhatsApp contact via new `whapi.sendVoiceMessage()` (see below)
  8. Return created message object
  9. Async: queue transcription via `extractAudioTranscript()`
- **Response:** The created message object (same shape as text message sends)
- **Failure handling:**
  - If ffmpeg conversion fails: return 500, clean up temp files, no DB row created
  - If Supabase upload fails: return 500, clean up temp files, no DB row created
  - If Whapi send fails: DB row and Supabase file are already persisted with `status: 'failed'`. Retry only re-sends via Whapi (no re-upload needed). Return the message with failed status so the client can show retry UI.

### Retry Endpoint

**`POST /api/messages/:messageId/retry-voice`** in `server/src/routes/messages.ts`

- **Auth:** `requirePermission('messages', 'create')`
- **Validation:** Zod schema for `messageId` (UUID). Verify the message belongs to the user's company, has `message_type: 'voice'`, and has `status: 'failed'`.
- **Processing:**
  1. Look up the existing `chat_messages` row by `messageId` + `company_id`
  2. Retrieve the OGG file from Supabase using the stored `media_storage_path`
  3. Re-send via `whapi.sendVoiceMessage()` using a signed URL
  4. On success: update `status` to `'sent'`, update session fields (same as initial send)
  5. On failure: keep `status: 'failed'`, return error so client can show retry again
- **Response:** Updated message object

### New Whapi Function

**`whapi.sendVoiceMessage()`** in `server/src/services/whapi.ts`

- Uses Whapi `POST /messages/voice` endpoint (or `POST /messages/audio` — verify during implementation against Whapi API docs)
- Payload options (check Whapi docs for which is supported):
  - **Option A (preferred):** Send a Supabase signed URL — Whapi downloads the file from URL. Generate a short-lived signed URL via `mediaStorage.getSignedUrl()`.
  - **Option B (fallback):** Upload the OGG buffer directly as multipart to Whapi.
- Parameters: `to` (phone number from session), `media` (URL or file), `caption` (optional, empty for voice notes)

### ffmpeg Integration

- **npm packages:** `fluent-ffmpeg` (Node.js wrapper) + `@ffmpeg-installer/ffmpeg` (bundles a static ffmpeg binary — no `apt-get` needed on Render's Node runtime)
- **No infrastructure changes to `render.yaml`** — the static binary works on Render's default Node environment
- **Temp files:** Conversion runs in `os.tmpdir()` with unique filenames: `path.join(os.tmpdir(), \`voice-${messageId}-input${ext}\`)` and `path.join(os.tmpdir(), \`voice-${messageId}-output.ogg\`)`. Cleaned up in `try/finally` block.
- **Error handling:** If conversion fails, return 500 and clean up temp files

### Transcription

- Reuses existing `extractAudioTranscript()` from `server/src/services/mediaContentExtractor.ts`
- Called with `(storagePath, mimeType)` — file is already in Supabase by the time transcription runs, so the function downloads from storage internally
- Runs async after the message is sent (does not block the send response)
- Result stored in `media_transcript` column on `chat_messages`

---

## Database Changes

**None required.** All needed columns already exist on `chat_messages`:

| Column | Usage |
|--------|-------|
| `message_type` | Set to `'voice'` |
| `message_body` | `'[Voice message M:SS]'` (for conversation list display) |
| `media_storage_path` | `{company_id}/{channel_id}/{message_id}.ogg` |
| `media_mime_type` | `'audio/ogg'` |
| `media_filename` | Generated filename |
| `media_transcript` | Whisper output (async) |
| `metadata` (JSONB) | `{ duration_seconds: number }` |

---

## Storage

Reuses existing `chat-media` Supabase bucket. No new buckets or policies needed.

Path pattern: `{company_id}/{channel_id}/{message_id}.ogg`

---

## Playback of Sent Voice Notes

Outbound voice notes reuse the **existing audio player** in `MessageBubble.tsx`. The current player already handles `audio`, `ptt`, and `voice` message types with:

- Play/pause button
- Waveform visualization
- Duration display
- Playback speed toggle (1x, 1.5x, 2x)

Since we use `message_type: 'voice'`, sent voice notes automatically render with this player. No new playback component needed.

### Optimistic UI During Send

1. Message appears immediately in thread with "sending" status indicator
2. Audio is playable immediately using `URL.createObjectURL(blob)` as a temporary source — user can listen to what they just sent without waiting for the server
3. Status updates to "sent" via Supabase Realtime subscription (existing subscription on `chat_messages` table)
4. Once server responds, the blob URL is replaced with the Supabase signed URL for persistent playback
5. On failure: status shows "failed" with retry button. Retry calls a dedicated `POST /api/messages/:messageId/retry-voice` endpoint that re-sends the already-stored Supabase file via Whapi (no re-upload needed).

---

## Infrastructure Changes

| Change | Details |
|--------|---------|
| `fluent-ffmpeg` npm package | Add to `server/package.json` |
| `@ffmpeg-installer/ffmpeg` npm package | Add to `server/package.json` — bundles static ffmpeg binary, no apt-get needed |
| No changes to `render.yaml` | Static binary works on Render's Node runtime |
| No new Supabase buckets | Reuses `chat-media` |
| No new DB migrations | All columns exist |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Mic permission denied | Frontend toast: "Microphone access required to send voice notes" |
| No microphone found | Frontend toast: "No microphone detected" |
| Browser doesn't support MediaRecorder | Hide mic button, graceful degradation |
| Upload fails (network) | Client retains audio blob in memory; user can retry upload |
| ffmpeg conversion fails | Server returns 500, no DB row created, frontend shows error toast |
| Supabase upload fails | Server returns 500, no DB row created, frontend shows error toast |
| Whapi send fails | DB row + Supabase file persisted with `status: 'failed'`; retry re-sends via Whapi only |
| 15-min limit reached | Auto-stop recording, trigger send flow |

---

## Scope Summary

| Area | New | Reused |
|------|-----|--------|
| **Frontend** | `VoiceRecordButton`, `VoiceRecordingBar`, `useVoiceRecorder` hook | `MessageBubble` audio player, waveform, `PlanGate` |
| **Backend** | `POST /messages/send-voice`, ffmpeg conversion, `whapi.sendVoiceMessage()` | `mediaStorage`, `extractAudioTranscript`, multer, session update logic |
| **Database** | Nothing | `chat_messages` media columns |
| **Infrastructure** | `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` npm packages | Supabase `chat-media` bucket, Render Node runtime |

---

## Out of Scope

- AI agents sending voice notes
- Upload of pre-recorded audio files
- Voice note forwarding between conversations
- Voice-to-text preview before sending
