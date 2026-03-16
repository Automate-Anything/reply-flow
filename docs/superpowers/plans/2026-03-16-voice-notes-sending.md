# Voice Notes — Outbound Sending Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable human agents to record and send voice notes to WhatsApp contacts from the inbox UI.

**Architecture:** Browser records audio via native MediaRecorder API with live waveform via Web Audio AnalyserNode. Raw audio is uploaded to the server, converted to OGG/Opus via ffmpeg (static binary via npm), stored in Supabase `chat-media` bucket, then sent to WhatsApp via Whapi. Async Whisper transcription runs after send.

**Tech Stack:** React 19, TypeScript, MediaRecorder API, Web Audio API, Express 5, fluent-ffmpeg, @ffmpeg-installer/ffmpeg, Supabase Storage, Whapi API, OpenAI Whisper

**Spec:** `docs/superpowers/specs/2026-03-16-voice-notes-sending-design.md`

---

## Chunk 1: Backend — ffmpeg Conversion Service

### Task 1: Install npm dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install fluent-ffmpeg and @ffmpeg-installer/ffmpeg**

```bash
npm --prefix server install fluent-ffmpeg @ffmpeg-installer/ffmpeg
```

- [ ] **Step 2: Install type definitions**

```bash
npm --prefix server install -D @types/fluent-ffmpeg
```

- [ ] **Step 3: Verify installation**

```bash
node -e "const ff = require('@ffmpeg-installer/ffmpeg'); console.log('ffmpeg path:', ff.path)"
```

Expected: prints the path to the bundled ffmpeg binary.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: add fluent-ffmpeg and @ffmpeg-installer/ffmpeg dependencies"
```

---

### Task 2: Create audio conversion service

**Files:**
- Create: `server/src/services/audioConverter.ts`

- [ ] **Step 1: Create the audio conversion service**

Create `server/src/services/audioConverter.ts`:

```typescript
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Point fluent-ffmpeg to the bundled static binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Converts an audio buffer (any browser-native format) to OGG/Opus.
 * Returns the converted OGG buffer.
 * Temp files are cleaned up in all cases (success or failure).
 */
export async function convertToOggOpus(
  inputBuffer: Buffer,
  messageId: string,
  inputMimeType: string,
): Promise<Buffer> {
  const ext = mimeToInputExt(inputMimeType);
  const inputPath = path.join(os.tmpdir(), `voice-${messageId}-input${ext}`);
  const outputPath = path.join(os.tmpdir(), `voice-${messageId}-output.ogg`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('64k')
        .format('ogg')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`ffmpeg conversion failed: ${err.message}`)))
        .run();
    });

    const outputBuffer = await fs.readFile(outputPath);
    return outputBuffer;
  } finally {
    // Clean up temp files regardless of success/failure
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

function mimeToInputExt(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': '.webm',
    'audio/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/x-m4a': '.m4a',
    'video/webm': '.webm', // some browsers report video/webm for audio-only
  };
  return map[mimeType] || '.webm';
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx --prefix server tsc --noEmit --project server/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/audioConverter.ts
git commit -m "feat(voice): add audio conversion service (ffmpeg OGG/Opus)"
```

---

## Chunk 2: Backend — Whapi Voice Message + Send Voice Endpoint

### Task 3: Add whapi.sendVoiceMessage()

**Files:**
- Modify: `server/src/services/whapi.ts` (after `sendTextMessage` around line 226)

- [ ] **Step 1: Read the current whapi.ts file**

Read `server/src/services/whapi.ts` to confirm the exact location and pattern.

- [ ] **Step 2: Add sendVoiceMessage function**

Add after the existing `sendTextMessage()` function (around line 226):

```typescript
export async function sendVoiceMessage(
  channelToken: string,
  to: string,
  mediaUrl: string,
): Promise<unknown> {
  const gate = gateApi(channelToken);
  const { data } = await gate.post('/messages/voice', {
    to,
    media: mediaUrl,
  });
  return data;
}
```

This follows the exact same pattern as `sendTextMessage()` — uses `gateApi()` to create an authenticated axios instance and posts to the Whapi endpoint. The `media` field accepts a URL (Supabase signed URL).

> **Implementation note:** If `POST /messages/voice` doesn't work, try `POST /messages/audio` — check Whapi API docs during implementation. The payload shape is the same.

- [ ] **Step 3: Verify it compiles**

```bash
npx --prefix server tsc --noEmit --project server/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/whapi.ts
git commit -m "feat(voice): add whapi.sendVoiceMessage() for outbound voice notes"
```

---

### Task 4: Create POST /messages/send-voice endpoint

**Files:**
- Modify: `server/src/routes/messages.ts`

This is the main endpoint. Reference the existing `POST /send` route (lines 13-146) for the session update pattern.

- [ ] **Step 1: Read messages.ts to confirm current structure**

Read `server/src/routes/messages.ts` fully to see imports, existing routes, and patterns.

- [ ] **Step 2: Add imports at the top of messages.ts**

Add these imports alongside existing ones:

```typescript
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import { convertToOggOpus } from '../services/audioConverter.js';
```

Note: `whapi` is already imported as `import * as whapi from '../services/whapi.js'` — use `whapi.sendVoiceMessage()` (namespace access, not a separate import). Similarly, `storeBuffer` and `getSignedUrl` should already be imported from `../services/mediaStorage.js`. You MUST also add this import (it is NOT currently in messages.ts):

```typescript
import { extractAudioTranscript } from '../services/mediaContentExtractor.js';
```

Also set up multer:

```typescript
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
}).single('audio');
```

- [ ] **Step 3: Add the Zod validation schema**

Add near the top with other schemas (if any) or before the route:

```typescript
const sendVoiceSchema = z.object({
  sessionId: z.string().uuid(),
  duration: z.coerce.number().positive().max(900),
});
```

- [ ] **Step 4: Add the POST /send-voice route**

Add after the existing `/send` route. This follows the same pattern but handles multipart audio upload, ffmpeg conversion, Supabase storage, DB insert, session update, Whapi send, and async transcription:

```typescript
router.post('/send-voice', requireAuth, requirePermission('messages', 'create'), (req, res, next) => {
  voiceUpload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Audio file too large (max 25MB)' });
      }
      return res.status(400).json({ error: 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const parsed = sendVoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { sessionId, duration } = parsed.data;
    const companyId = req.companyId!;
    const userId = req.userId!;

    // 1. Look up session to get channel info and chat_id
    // The !inner join on whatsapp_channels ensures the channel exists;
    // also filter for connected channels to avoid sending to disconnected ones
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, phone_number, chat_id, whatsapp_channels!inner(channel_token, channel_status)')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .eq('whatsapp_channels.channel_status', 'connected')
      .single();

    if (sessionErr || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Format chat_id for Whapi (same pattern as text send route)
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;

    // 2. Generate message ID
    const messageId = crypto.randomUUID();

    // 3. Convert to OGG/Opus
    const oggBuffer = await convertToOggOpus(file.buffer, messageId, file.mimetype);

    // 4. Upload to Supabase Storage
    const storagePath = await storeBuffer(
      oggBuffer,
      companyId,
      session.channel_id,
      messageId,
      'audio/ogg',
    );

    if (!storagePath) {
      return res.status(500).json({ error: 'Failed to store audio file' });
    }

    // 5. Format duration for message body
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const now = new Date().toISOString();

    // 6. Send to WhatsApp via Whapi
    let status = 'sent';
    try {
      const channelToken = (session as any).whatsapp_channels.channel_token;
      const signedUrl = await getSignedUrl(storagePath, 300); // 5-min URL for Whapi to download
      if (!signedUrl) throw new Error('Failed to generate signed URL');
      await whapi.sendVoiceMessage(channelToken, chatId, signedUrl);
    } catch (whapiErr) {
      console.error('Whapi voice send failed:', whapiErr);
      status = 'failed';
    }

    // 7. Insert chat_messages row
    const { data: message, error: insertErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        id: messageId,
        session_id: sessionId,
        company_id: companyId,
        user_id: userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: `[Voice message ${durationStr}]`,
        message_type: 'voice',
        direction: 'outbound',
        sender_type: 'human',
        status,
        read: true,
        message_ts: now,
        media_storage_path: storagePath,
        media_mime_type: 'audio/ogg',
        media_filename: `voice-${messageId}.ogg`,
        metadata: { duration_seconds: duration },
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to insert voice message:', insertErr);
      return res.status(500).json({ error: 'Failed to save voice message' });
    }

    // 8. Update chat_sessions (same pattern as text send route)
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: '[Voice message]',
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', sessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    // 9. Mark inbound messages as read
    await supabaseAdmin
      .from('chat_messages')
      .update({ read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('read', false);

    // 10. Async transcription (fire-and-forget)
    extractAudioTranscript(storagePath, 'audio/ogg')
      .then(async (transcript) => {
        if (transcript) {
          await supabaseAdmin
            .from('chat_messages')
            .update({ media_transcript: transcript })
            .eq('id', messageId);
        }
      })
      .catch((err) => console.error('Voice transcription failed:', err));

    return res.json({ message });
  } catch (err) {
    console.error('Voice send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Important:** Make sure `storeBuffer`, `getSignedUrl` are imported from `../services/mediaStorage`, and `extractAudioTranscript` from `../services/mediaContentExtractor`. Check the existing imports at the top of messages.ts — some may already be imported.

- [ ] **Step 5: Verify it compiles**

```bash
npx --prefix server tsc --noEmit --project server/tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/messages.ts
git commit -m "feat(voice): add POST /messages/send-voice endpoint"
```

---

### Task 5: Create POST /messages/:messageId/retry-voice endpoint

**Files:**
- Modify: `server/src/routes/messages.ts`

- [ ] **Step 1: Add Zod schema for retry**

```typescript
const retryVoiceSchema = z.object({
  messageId: z.string().uuid(),
});
```

- [ ] **Step 2: Add the retry route**

Add after the `/send-voice` route:

```typescript
router.post('/:messageId/retry-voice', requireAuth, requirePermission('messages', 'create'), async (req, res) => {
  try {
    const parsed = retryVoiceSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }
    const { messageId } = parsed.data;
    const companyId = req.companyId!;

    // 1. Look up the failed voice message
    const { data: message, error: msgErr } = await supabaseAdmin
      .from('chat_messages')
      .select('*, chat_sessions!inner(channel_id, phone_number, chat_id, whatsapp_channels!inner(channel_token, channel_status))')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .eq('message_type', 'voice')
      .eq('status', 'failed')
      .eq('chat_sessions.whatsapp_channels.channel_status', 'connected')
      .single();

    if (msgErr || !message) {
      return res.status(404).json({ error: 'Failed voice message not found' });
    }

    // 2. Generate signed URL for the existing stored file
    const signedUrl = await getSignedUrl(message.media_storage_path, 300);
    if (!signedUrl) {
      return res.status(500).json({ error: 'Failed to generate media URL' });
    }

    // 3. Re-send via Whapi
    const sessionData = (message as any).chat_sessions;
    const channelToken = sessionData.whatsapp_channels.channel_token;
    const chatId = sessionData.chat_id.includes('@')
      ? sessionData.chat_id
      : `${sessionData.chat_id}@s.whatsapp.net`;
    await whapi.sendVoiceMessage(channelToken, chatId, signedUrl);

    // 4. Update status to sent
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('chat_messages')
      .update({ status: 'sent', updated_at: now })
      .eq('id', messageId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ error: 'Failed to update message status' });
    }

    // 5. Update session
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: '[Voice message]',
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', message.session_id)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    return res.json({ message: updated });
  } catch (err) {
    console.error('Voice retry error:', err);
    return res.status(500).json({ error: 'Retry failed' });
  }
});
```

- [ ] **Step 3: Verify it compiles**

```bash
npx --prefix server tsc --noEmit --project server/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/messages.ts
git commit -m "feat(voice): add POST /messages/:messageId/retry-voice endpoint"
```

---

## Chunk 3: Frontend — useVoiceRecorder Hook

### Task 6: Create the useVoiceRecorder hook

**Files:**
- Create: `client/src/hooks/useVoiceRecorder.ts`

This hook encapsulates all browser recording logic: MediaRecorder, AnalyserNode for waveform, duration tracking, and the 15-minute auto-stop.

- [ ] **Step 1: Create the hook**

Create `client/src/hooks/useVoiceRecorder.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'paused';

interface UseVoiceRecorderReturn {
  state: RecorderState;
  duration: number;
  analyserNode: AnalyserNode | null;
  audioBlob: Blob | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; duration: number }>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

const MAX_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function useVoiceRecorder(
  onAutoStop?: (blob: Blob, duration: number) => void,
): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle');
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setAnalyserNode(null);
  }, []);

  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
      setDuration(elapsed / 1000);
    }, 100);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      setDuration(0);
      elapsedBeforePauseRef.current = 0;
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up AnalyserNode for waveform
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // Set up MediaRecorder
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        setAudioBlob(blob);
      };

      recorder.start(100); // Collect data every 100ms for responsive stopping
      setState('recording');
      startDurationTimer();

      // Auto-stop at 15 minutes
      maxDurationTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
          stopDurationTimer();
          mediaRecorderRef.current.stop();
          setState('idle');
          // Notify caller about auto-stop so they can trigger send
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          onAutoStop?.(blob, elapsed / 1000);
          cleanup();
        }
      }, MAX_DURATION_MS);
    } catch (err: any) {
      cleanup();
      setState('idle');
      if (err.name === 'NotAllowedError') {
        setError('Microphone access required to send voice notes');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone detected');
      } else {
        setError('Failed to start recording');
      }
    }
  }, [cleanup, startDurationTimer, stopDurationTimer, onAutoStop]);

  const stop = useCallback((): Promise<{ blob: Blob; duration: number }> => {
    return new Promise((resolve) => {
      stopDurationTimer();
      const finalDuration = (elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current)) / 1000;

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        // Override onstop to resolve the promise with the blob
        mediaRecorderRef.current.onstop = () => {
          const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mimeType });
          setAudioBlob(blob);
          resolve({ blob, duration: finalDuration });
        };
        mediaRecorderRef.current.stop();
      }

      setState('idle');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (maxDurationTimeoutRef.current) {
        clearTimeout(maxDurationTimeoutRef.current);
        maxDurationTimeoutRef.current = null;
      }
      setAnalyserNode(null);
    });
  }, [stopDurationTimer]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      stopDurationTimer();
      setState('paused');
    }
  }, [stopDurationTimer]);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      startDurationTimer();
      setState('recording');
    }
  }, [startDurationTimer]);

  const cancel = useCallback(() => {
    cleanup();
    setState('idle');
    setDuration(0);
    setAudioBlob(null);
    elapsedBeforePauseRef.current = 0;
  }, [cleanup]);

  return {
    state,
    duration,
    analyserNode,
    audioBlob,
    error,
    start,
    stop,
    pause,
    resume,
    cancel,
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useVoiceRecorder.ts
git commit -m "feat(voice): add useVoiceRecorder hook with MediaRecorder + AnalyserNode"
```

---

## Chunk 4: Frontend — Recording UI Components

### Task 7: Create VoiceRecordingBar component

**Files:**
- Create: `client/src/components/inbox/VoiceRecordingBar.tsx`

This component shows during active recording: live waveform, timer, and control buttons (delete, pause/resume, send).

- [ ] **Step 1: Create VoiceRecordingBar**

Create `client/src/components/inbox/VoiceRecordingBar.tsx`:

```typescript
import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Pause, Play, Send } from 'lucide-react';
import type { RecorderState } from '@/hooks/useVoiceRecorder';

interface VoiceRecordingBarProps {
  state: RecorderState;
  duration: number;
  analyserNode: AnalyserNode | null;
  onSend: () => void;
  onDelete: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function VoiceRecordingBar({
  state,
  duration,
  analyserNode,
  onSend,
  onDelete,
  onPause,
  onResume,
}: VoiceRecordingBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (state === 'paused') return; // freeze waveform when paused
      animationFrameRef.current = requestAnimationFrame(draw);

      analyserNode.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barWidth = Math.max(2, (width / bufferLength) * 2.5);
      const gap = 1;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.8;
        const y = (height - barHeight) / 2;

        ctx.fillStyle = 'hsl(var(--primary))';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - gap, barHeight || 2, 1);
        ctx.fill();

        x += barWidth;
        if (x > width) break;
      }
    };

    draw();
  }, [analyserNode, state]);

  useEffect(() => {
    if (state === 'recording' && analyserNode) {
      drawWaveform();
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state, analyserNode, drawWaveform]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 w-full">
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-sm font-mono text-muted-foreground w-12 shrink-0">
          {formatDuration(duration)}
        </span>
        <canvas
          ref={canvasRef}
          className="flex-1 h-8"
          width={300}
          height={32}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={state === 'paused' ? onResume : onPause}
        className="h-8 w-8 shrink-0"
      >
        {state === 'paused' ? (
          <Play className="h-4 w-4" />
        ) : (
          <Pause className="h-4 w-4" />
        )}
      </Button>

      <Button
        size="icon"
        onClick={onSend}
        className="h-9 w-9 shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/VoiceRecordingBar.tsx
git commit -m "feat(voice): add VoiceRecordingBar component with live waveform"
```

---

### Task 8: Create VoiceRecordButton component

**Files:**
- Create: `client/src/components/inbox/VoiceRecordButton.tsx`

This component handles the mic button with touch (hold-to-record, swipe-to-lock) and pointer (click-to-record) interactions.

- [ ] **Step 1: Create VoiceRecordButton**

Create `client/src/components/inbox/VoiceRecordButton.tsx`:

```typescript
import { useCallback, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VoiceRecordButtonProps {
  onRecordStart: () => Promise<void>;
  onRecordStop: () => void;
  onLock: () => void;
  disabled?: boolean;
}

const SWIPE_UP_THRESHOLD = 60; // px vertical
const SWIPE_HORIZONTAL_TOLERANCE = 30; // px horizontal

export function VoiceRecordButton({
  onRecordStart,
  onRecordStop,
  onLock,
  disabled,
}: VoiceRecordButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isRecordingRef = useRef(false);

  const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // --- Touch (mobile) handlers ---

  const handleTouchStart = useCallback(async (e: React.TouchEvent) => {
    if (disabled) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsHolding(true);
    isRecordingRef.current = true;
    await onRecordStart();
  }, [disabled, onRecordStart]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isRecordingRef.current) return;
    setIsHolding(false);

    const touch = e.changedTouches[0];
    const start = touchStartRef.current;

    if (start) {
      const dy = start.y - touch.clientY; // positive = swiped up
      const dx = Math.abs(touch.clientX - start.x);

      if (dy >= SWIPE_UP_THRESHOLD && dx <= SWIPE_HORIZONTAL_TOLERANCE) {
        // Swipe up → lock recording
        onLock();
        isRecordingRef.current = false;
        touchStartRef.current = null;
        return;
      }
    }

    // Normal release → send immediately
    onRecordStop();
    isRecordingRef.current = false;
    touchStartRef.current = null;
  }, [onRecordStop, onLock]);

  const handleTouchCancel = useCallback(() => {
    setIsHolding(false);
    isRecordingRef.current = false;
    touchStartRef.current = null;
  }, []);

  // --- Pointer (desktop) handler ---

  const handleClick = useCallback(async () => {
    if (disabled || isTouchDevice()) return;
    await onRecordStart();
    onLock(); // Desktop always shows the recording bar
  }, [disabled, onRecordStart, onLock]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-9 w-9 shrink-0 ${isHolding ? 'bg-destructive/10 text-destructive' : ''}`}
      disabled={disabled}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/VoiceRecordButton.tsx
git commit -m "feat(voice): add VoiceRecordButton with touch hold/swipe and desktop click"
```

---

## Chunk 5: Frontend — Integration into MessageInput + Optimistic Send

### Task 9: Add sendVoiceNote to useMessages hook

**Files:**
- Modify: `client/src/hooks/useMessages.ts`

- [ ] **Step 1: Read useMessages.ts to confirm current structure**

Read `client/src/hooks/useMessages.ts` fully.

- [ ] **Step 2: Add sendVoiceNote function**

Add a new function alongside the existing `sendMessage` function. Follow the same optimistic update pattern (lines 51-100 of useMessages.ts):

```typescript
const sendVoiceNote = useCallback(
  async (audioBlob: Blob, duration: number) => {
    if (!sessionId) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Create optimistic message with blob URL for immediate playback
    const blobUrl = URL.createObjectURL(audioBlob);
    const optimisticMsg: Message = {
      id: tempId,
      session_id: sessionId,
      message_body: `[Voice message ${durationStr}]`,
      message_type: 'voice',
      direction: 'outbound',
      sender_type: 'human',
      status: 'pending',
      read: true,
      message_ts: now,
      scheduled_for: null,
      created_at: now,
      metadata: { duration_seconds: duration, _blobUrl: blobUrl },
      is_starred: false,
      is_pinned: false,
      reactions: [],
      media_storage_path: null,
      media_mime_type: 'audio/ogg',
      media_filename: null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice-note.webm');
      formData.append('sessionId', sessionId);
      formData.append('duration', duration.toString());

      const { data } = await api.post('/messages/send-voice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Replace temp message with real one, revoke blob URL
      const realId = data.message.id;
      URL.revokeObjectURL(blobUrl);
      setMessages((prev) => {
        const withoutDupe = prev.filter((m) => m.id !== realId);
        return withoutDupe.map((m) => (m.id === tempId ? data.message : m));
      });
      return data.message;
    } catch (err) {
      // Keep blob URL alive for retry; mark as failed
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
      );
      throw err;
    }
  },
  [sessionId],
);
```

Also add `sendVoiceNote` to the hook's return value.

- [ ] **Step 3: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMessages.ts
git commit -m "feat(voice): add sendVoiceNote with optimistic UI and blob URL playback"
```

---

### Task 10: Integrate voice recording into MessageInput

**Files:**
- Modify: `client/src/components/inbox/MessageInput.tsx`

This is the main integration point — we add the mic button and recording bar to the existing message input area.

- [ ] **Step 1: Read MessageInput.tsx to confirm current structure**

Read `client/src/components/inbox/MessageInput.tsx` fully.

- [ ] **Step 2: Add imports**

Add at the top of MessageInput.tsx:

```typescript
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordButton } from './VoiceRecordButton';
import { VoiceRecordingBar } from './VoiceRecordingBar';
```

- [ ] **Step 3: Update the MessageInputProps interface**

Add the voice note send callback:

```typescript
interface MessageInputProps {
  onSend: (body: string) => Promise<void>;
  onSendVoiceNote: (blob: Blob, duration: number) => Promise<void>;
  onSchedule: (body: string, scheduledFor: string) => Promise<void>;
  disabled?: boolean;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}
```

- [ ] **Step 4: Add voice recorder state to the component body**

Inside the component, add:

```typescript
const [isRecordingLocked, setIsRecordingLocked] = useState(false);

const handleVoiceSend = useCallback(async (blob: Blob, dur: number) => {
  try {
    await onSendVoiceNote(blob, dur);
  } catch {
    // Error toast is handled by the caller
  }
  setIsRecordingLocked(false);
}, [onSendVoiceNote]);

const recorder = useVoiceRecorder((blob, dur) => {
  // Auto-stop at 15 min triggers send
  handleVoiceSend(blob, dur);
});

const handleVoiceRecordStop = useCallback(async () => {
  const { blob, duration: dur } = await recorder.stop();
  handleVoiceSend(blob, dur);
}, [recorder, handleVoiceSend]);

const handleVoiceLock = useCallback(() => {
  setIsRecordingLocked(true);
}, []);

const handleVoiceBarSend = useCallback(async () => {
  const { blob, duration: dur } = await recorder.stop();
  handleVoiceSend(blob, dur);
}, [recorder, handleVoiceSend]);

const handleVoiceBarDelete = useCallback(() => {
  recorder.cancel();
  setIsRecordingLocked(false);
}, [recorder]);
```

- [ ] **Step 5: Update the JSX — show recording bar when recording is locked**

When `isRecordingLocked` is true OR `recorder.state !== 'idle'` with lock, replace the input area with `VoiceRecordingBar`. When not recording, show the mic button next to the send button (when text is empty).

Wrap the existing input area in a conditional:

```tsx
{isRecordingLocked ? (
  <VoiceRecordingBar
    state={recorder.state}
    duration={recorder.duration}
    analyserNode={recorder.analyserNode}
    onSend={handleVoiceBarSend}
    onDelete={handleVoiceBarDelete}
    onPause={recorder.pause}
    onResume={recorder.resume}
  />
) : (
  // ... existing input area JSX ...
)}
```

In the existing button area (around line 446), add the mic button when there's no text:

```tsx
{!hasText && typeof navigator !== 'undefined' && typeof MediaRecorder !== 'undefined' && (
  <PlanGate>
    <VoiceRecordButton
      onRecordStart={recorder.start}
      onRecordStop={handleVoiceRecordStop}
      onLock={handleVoiceLock}
      disabled={disabled}
    />
  </PlanGate>
)}
```

Keep the existing send button visible only when there IS text (it may already be conditional on `hasText`).

- [ ] **Step 6: Show error toasts for recorder errors**

Add an effect to show toast when `recorder.error` changes:

```typescript
useEffect(() => {
  if (recorder.error) {
    toast.error(recorder.error);
  }
}, [recorder.error]);
```

(Import `toast` from sonner if not already imported.)

- [ ] **Step 7: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git add client/src/components/inbox/MessageInput.tsx
git commit -m "feat(voice): integrate voice recording into MessageInput with mic button and recording bar"
```

---

### Task 11: Wire up sendVoiceNote in the parent component

**Files:**
- Modify: the parent component that renders `MessageInput` AND any intermediary components in the prop chain

- [ ] **Step 1: Find the full prop chain**

Search for `<MessageInput` in the codebase. Then search for `onSend` prop to trace how the text send callback is passed from the component that calls `useMessages` down to `MessageInput`. You need to add `onSendVoiceNote` / `sendVoiceNote` through the same prop-drilling chain.

Likely chain: component using `useMessages` → `MessageThread` (via props) → `MessageInput` (via props).

- [ ] **Step 2: Add sendVoiceNote to useMessages return value**

If not already done in Task 9, ensure `sendVoiceNote` is included in the `useMessages` return object.

- [ ] **Step 3: Thread the prop through each component**

For each component in the chain:
1. Add `onSendVoiceNote` to the component's props interface
2. Pass it down to the child: `<MessageInput onSendVoiceNote={sendVoiceNote} ... />`

Also add `onSendVoiceNote` to `MessageThread`'s props interface if `MessageThread` is in the chain.

- [ ] **Step 4: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/inbox/
git commit -m "feat(voice): wire sendVoiceNote through component chain to MessageInput"
```

---

## Chunk 6: Frontend — Optimistic Playback with Blob URL

### Task 12: Support blob URL playback in MessageBubble

**Files:**
- Modify: `client/src/components/inbox/MessageBubble.tsx`

The media URL for playback is resolved by the `useMediaUrl` hook (around line 685 of `MessageBubble.tsx`), NOT inside `MediaContent`. For optimistic voice messages (with `status: 'pending'` and `id` starting with `temp-`), we need to use the blob URL stored in `metadata._blobUrl` instead of calling the API.

- [ ] **Step 1: Read MessageBubble.tsx useMediaUrl hook**

Read `MessageBubble.tsx` and find the `useMediaUrl` hook definition/usage to understand how it fetches signed URLs.

- [ ] **Step 2: Modify useMediaUrl to support blob URLs and skip temp messages**

In the `useMediaUrl` hook (or wherever the media URL fetch logic lives), add two guards:

```typescript
// 1. If the message has a blob URL in metadata, use it directly
const blobUrl = message.metadata?._blobUrl as string | undefined;

// 2. Skip API call for temp messages (optimistic) or when blob URL exists
useEffect(() => {
  if (blobUrl) {
    setMediaUrl(blobUrl);
    return;
  }
  // Skip fetch for optimistic messages (they don't exist on the server yet)
  if (message.id.startsWith('temp-')) return;
  // ... existing signed URL fetch logic ...
}, [message.id, blobUrl]);
```

This ensures:
- Optimistic voice messages play immediately via `blob:` URL
- No 404 errors from trying to fetch media for temp messages
- When the real message replaces the temp one, the normal signed URL fetch kicks in

- [ ] **Step 3: Verify it compiles**

```bash
npx --prefix client tsc --noEmit --project client/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/inbox/MessageBubble.tsx
git commit -m "feat(voice): support blob URL for optimistic voice note playback"
```

---

## Chunk 7: Manual Testing & Final Build Verification

### Task 13: Build verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: both client and server build successfully with no errors.

- [ ] **Step 2: Run TypeScript checks**

```bash
npx --prefix server tsc --noEmit --project server/tsconfig.json && npx --prefix client tsc --noEmit --project client/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 4: Fix any issues found**

Address any build, type, or lint errors. Commit fixes.

---

### Task 14: Manual testing checklist

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test desktop flow**

1. Open inbox, select a conversation
2. Verify mic button appears when text input is empty
3. Click mic button → recording bar appears with waveform, timer, delete/pause/send buttons
4. Verify waveform animates while speaking
5. Click pause → waveform freezes, timer stops
6. Click resume → waveform resumes
7. Click send → voice note appears in thread as "sending", then "sent"
8. Verify audio is playable in the thread
9. Click delete → recording discarded, input returns to normal

- [ ] **Step 3: Test mobile flow (use Chrome DevTools device emulation)**

1. Hold mic button → recording starts
2. Release → sends immediately
3. Hold mic button → swipe up → recording bar appears (locked mode)
4. Tap send → sends
5. Hold mic button → swipe up → tap delete → discards

- [ ] **Step 4: Test error cases**

1. Block microphone permission → verify toast error
2. Kill network during upload → verify "failed" status with retry option

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(voice): complete outbound voice note sending implementation"
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `server/package.json` | Modify | Add fluent-ffmpeg + @ffmpeg-installer/ffmpeg |
| `server/src/services/audioConverter.ts` | Create | ffmpeg OGG/Opus conversion service |
| `server/src/services/whapi.ts` | Modify | Add `sendVoiceMessage()` |
| `server/src/routes/messages.ts` | Modify | Add `POST /send-voice` + `POST /:messageId/retry-voice` |
| `client/src/hooks/useVoiceRecorder.ts` | Create | MediaRecorder + AnalyserNode hook |
| `client/src/hooks/useMessages.ts` | Modify | Add `sendVoiceNote()` with optimistic UI |
| `client/src/components/inbox/VoiceRecordingBar.tsx` | Create | Recording controls + live waveform |
| `client/src/components/inbox/VoiceRecordButton.tsx` | Create | Mic button with touch/pointer modes |
| `client/src/components/inbox/MessageInput.tsx` | Modify | Integrate mic button + recording bar |
| `client/src/components/inbox/MessageBubble.tsx` | Modify | Blob URL support for optimistic playback |
| Parent of MessageInput (e.g., MessageThread.tsx) | Modify | Wire `sendVoiceNote` prop |
