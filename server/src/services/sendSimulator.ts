import * as whapi from './whapi.js';

// --- Speed Profiles ---

type SpeedProfile = 'fast' | 'normal' | 'slow';

const TIMING: Record<SpeedProfile, {
  openApp: [number, number];
  read: [number, number];
  typingPer100Chars: [number, number];
  recordingPer10s: [number, number];
}> = {
  fast:   { openApp: [1, 3],   read: [1, 2], typingPer100Chars: [1.5, 3], recordingPer10s: [8, 12] },
  normal: { openApp: [3, 8],   read: [2, 5], typingPer100Chars: [3, 5],   recordingPer10s: [10, 15] },
  slow:   { openApp: [5, 15],  read: [3, 8], typingPer100Chars: [4, 7],   recordingPer10s: [12, 20] },
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickProfile(): SpeedProfile {
  const r = Math.random();
  if (r < 0.3) return 'fast';
  if (r < 0.7) return 'normal';
  return 'slow';
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// --- Per-Channel Queue ---

const MAX_QUEUE_DEPTH = 10;
const channelQueues = new Map<string, { promise: Promise<void>; depth: number }>();

function enqueue(channelId: string, fn: () => Promise<void>): Promise<void> {
  const entry = channelQueues.get(channelId);
  const currentDepth = entry?.depth ?? 0;

  if (currentDepth >= MAX_QUEUE_DEPTH) {
    return Promise.resolve();
  }

  const prev = entry?.promise ?? Promise.resolve();
  const next = prev.then(fn, fn);

  channelQueues.set(channelId, { promise: next, depth: currentDepth + 1 });

  next.finally(() => {
    const current = channelQueues.get(channelId);
    if (current) {
      current.depth = Math.max(0, current.depth - 1);
      if (current.depth === 0) channelQueues.delete(channelId);
    }
  });

  return next;
}

// --- Main Simulation Function ---

export interface SimulateOptions {
  channelToken: string;
  chatId: string;
  inboundMessageId?: string;
  messageType: 'text' | 'voice';
  messageLength: number;
  path: 'scheduled' | 'auto_reply' | 'ai_agent';
  aiProcessingTimeMs?: number;
  channelType?: 'whatsapp' | 'email';
}

export async function simulateBeforeSend(options: SimulateOptions): Promise<void> {
  // No typing indicators for email channels
  if (options.channelType === 'email') return;

  const channelKey = options.channelToken;

  const wasQueued = (channelQueues.get(channelKey)?.depth ?? 0) >= MAX_QUEUE_DEPTH;
  if (wasQueued) return;

  return enqueue(channelKey, () => runSimulation(options));
}

async function runSimulation(options: SimulateOptions): Promise<void> {
  const { channelToken, chatId, inboundMessageId, messageType, messageLength, path, aiProcessingTimeMs } = options;

  try {
    const profile = pickProfile();
    const timing = path === 'auto_reply'
      ? TIMING.fast
      : TIMING[profile];

    // 1. Set online presence
    await whapi.setOnlinePresence(channelToken);

    // 2. Simulate opening the app
    await sleep(randomBetween(...timing.openApp));

    // 3. Mark inbound message as read (blue ticks)
    if (inboundMessageId) {
      await whapi.markMessageAsRead(channelToken, inboundMessageId);
    }

    // 4. Simulate reading the message
    await sleep(randomBetween(...timing.read));

    // 5. Start typing or recording indicator
    if (messageType === 'voice') {
      await whapi.setRecordingPresence(channelToken, chatId);
    } else {
      await whapi.setTypingPresence(channelToken, chatId);
    }

    // 6. Wait proportional to message length
    let typingDuration: number;
    if (messageType === 'voice') {
      typingDuration = randomBetween(...timing.recordingPer10s) * (messageLength / 10);
    } else {
      typingDuration = randomBetween(...timing.typingPer100Chars) * (messageLength / 100);
    }

    // For AI path: subtract API processing time already elapsed
    if (path === 'ai_agent' && aiProcessingTimeMs) {
      typingDuration = Math.max(1, typingDuration - aiProcessingTimeMs / 1000);
    }

    typingDuration = Math.max(1, typingDuration);

    await sleep(typingDuration);

    // Step 7 (actual send) happens at the call site, after this function returns
  } catch (err) {
    // Presence failures must never block message delivery
    console.error('Send simulation failed (non-blocking):', err);
  }
}
