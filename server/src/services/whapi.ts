import axios from 'axios';
import { env } from '../config/env.js';
import type { WhapiChannel, WhapiHealthResponse, WhapiContactProfile, WhapiUserProfile } from '../types/whapi.js';

const MANAGER_URL = 'https://manager.whapi.cloud';
const GATE_URL = 'https://gate.whapi.cloud';

const managerApi = axios.create({
  baseURL: MANAGER_URL,
  headers: { Authorization: `Bearer ${env.WHAPI_PARTNER_TOKEN}` },
});

function gateApi(channelToken: string) {
  return axios.create({
    baseURL: GATE_URL,
    headers: { Authorization: `Bearer ${channelToken}` },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractErrorDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return String(data);
  const obj = data as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  return JSON.stringify(data);
}

// ── Manager API (Partner Token) ──────────────────────────────────────────────

export async function createChannel(name: string): Promise<WhapiChannel> {
  try {
    const projectId = env.WHAPI_PROJECT_ID;
    const { data } = await managerApi.put('/channels', {
      name,
      projectId,
    });
    return {
      id: data.id,
      token: data.token,
      name: data.name,
      status: data.status,
    };
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      throw new Error(`WhAPI create channel error (${status}): ${extractErrorDetail(err.response.data)}`);
    }
    throw err;
  }
}

export async function getChannelPhone(channelId: string): Promise<string | null> {
  try {
    const { data } = await managerApi.get(`/channels/${channelId}`);
    if (!data.phone) return null;
    // Ensure E.164 format with + prefix
    return data.phone.startsWith('+') ? data.phone : `+${data.phone}`;
  } catch {
    return null;
  }
}

export async function extendChannel(channelId: string, days: number): Promise<void> {
  try {
    await managerApi.post(`/channels/${channelId}/extend`, {
      days,
      comment: `Reply Flow auto-provision (${days}d)`,
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      throw new Error(`WhAPI extend channel error (${status}): ${extractErrorDetail(err.response.data)}`);
    }
    throw err;
  }
}

export async function deleteChannel(channelId: string): Promise<void> {
  try {
    await managerApi.delete(`/channels/${channelId}`);
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return;
    throw err;
  }
}

// ── Gate API (Channel Token) ─────────────────────────────────────────────────

/**
 * Wait for the channel to finish provisioning on the Gate API.
 * WhAPI docs say initialization can take up to 90 seconds.
 * Polls /health?wakeup=true every 5s for up to timeoutMs.
 */
export async function waitForReady(channelToken: string, timeoutMs = 120_000, signal?: AbortSignal): Promise<void> {
  const gate = gateApi(channelToken);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new DOMException('Provisioning cancelled', 'AbortError');
    try {
      await gate.get('/health', { params: { wakeup: true } });
      return; // 200 = channel is ready
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        // Retry on: no response (channel offline/unreachable), 404 (not provisioned yet), 5xx (starting up)
        // Throw on: 4xx errors that won't self-resolve (e.g. 401, 402, 403)
        if (!status || status === 404 || status >= 500) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 5000);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('Provisioning cancelled', 'AbortError'));
            }, { once: true });
          });
          continue;
        }
      }
      throw err; // Unexpected error (e.g. auth failure)
    }
  }
  throw new Error('Channel provisioning timed out after 2 minutes');
}

/**
 * Get QR code as raw string data + expiry time.
 * Uses /users/login/rowdata which returns the raw QR string
 * that can be rendered by qrcode.react's QRCodeSVG.
 */
export async function getQR(channelToken: string): Promise<{ qr: string; expire: number | null }> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get('/users/login/rowdata');
    return {
      qr: data.qr || data.data || data.rowdata || '',
      expire: typeof data.expire === 'number' ? data.expire : null,
    };
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      throw new Error(`WhAPI QR error (${status}): ${extractErrorDetail(err.response.data)}`);
    }
    throw err;
  }
}

export async function checkHealth(
  channelToken: string,
  wakeup = false
): Promise<WhapiHealthResponse> {
  const gate = gateApi(channelToken);
  const { data } = await gate.get('/health', wakeup ? { params: { wakeup: true } } : {});
  return data;
}

export async function registerWebhook(
  channelToken: string,
  webhookUrl: string
): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.patch('/settings', {
    webhooks: [
      {
        url: webhookUrl,
        events: [
          { type: 'messages', method: 'post' },
          { type: 'statuses', method: 'post' },
        ],
      },
    ],
  });
}

export async function getGroupInfo(
  channelToken: string,
  groupId: string
): Promise<{ name: string } | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get(`/groups/${groupId}`);
    return { name: data.name || '' };
  } catch {
    return null;
  }
}

export async function getContactProfile(
  channelToken: string,
  phone: string
): Promise<WhapiContactProfile | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get(`/contacts/${phone}/profile`);
    return { icon: data.icon || '', icon_full: data.icon_full || '' };
  } catch {
    return null;
  }
}

/**
 * Get the authenticated user's own WhatsApp profile (name, picture, about).
 * This is different from getContactProfile which fetches other contacts.
 */
export async function getUserProfile(
  channelToken: string
): Promise<WhapiUserProfile | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get('/users/profile');
    return {
      name: data.name || '',
      icon: data.icon || '',
      icon_full: data.icon_full || '',
      about: data.about || '',
      phone: data.phone || '',
    };
  } catch {
    return null;
  }
}

export async function logoutChannel(channelToken: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.post('/users/logout');
}

export async function sendTextMessage(
  channelToken: string,
  to: string,
  body: string,
  quoted?: string
): Promise<unknown> {
  const gate = gateApi(channelToken);
  const payload: Record<string, string> = { to, body };
  if (quoted) payload.quoted = quoted;
  const { data } = await gate.post('/messages/text', payload);
  return data;
}

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

// ── Message Actions ──────────────────────────────────────────────────────────

export async function starMessage(channelToken: string, messageId: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.put(`/messages/${messageId}/star`);
}

export async function unstarMessage(channelToken: string, messageId: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.delete(`/messages/${messageId}/star`);
}

export async function pinMessage(channelToken: string, messageId: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.post(`/messages/${messageId}/pin`);
}

export async function unpinMessage(channelToken: string, messageId: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.delete(`/messages/${messageId}/pin`);
}

export async function reactToMessage(channelToken: string, messageId: string, emoji: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.put(`/messages/${messageId}/reaction`, { emoji });
}

/**
 * Downloads media binary by its Whapi media ID.
 * Whapi's GET /media/{id} returns raw binary data, not a JSON URL.
 */
export async function downloadMediaById(channelToken: string, mediaId: string): Promise<Buffer | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get(`/media/${mediaId}`, { responseType: 'arraybuffer' });
    return Buffer.from(data);
  } catch {
    return null;
  }
}

/**
 * Fetches a message from Whapi by its WhatsApp message ID.
 * Returns the media link/info if the message contains media.
 */
export async function getMessageById(channelToken: string, messageId: string): Promise<{
  type?: string;
  media?: { id?: string; link?: string; mime_type?: string };
} | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get(`/messages/${messageId}`);
    const mediaPayload = data?.image || data?.document || data?.audio || data?.voice || data?.video;
    return {
      type: data?.type,
      media: mediaPayload ? {
        id: mediaPayload.id,
        link: mediaPayload.link,
        mime_type: mediaPayload.mime_type,
      } : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches the full raw message object from Whapi by its WhatsApp message ID.
 * Used to enrich webhook payloads that may be missing fields (e.g. link_preview).
 */
export async function fetchFullMessage(channelToken: string, messageId: string): Promise<Record<string, unknown> | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get(`/messages/${messageId}`);
    return data;
  } catch {
    return null;
  }
}

/**
 * @deprecated Use downloadMediaById() instead — Whapi returns binary, not a URL.
 * Kept for backward compatibility but will always return null.
 */
export async function getMediaUrl(channelToken: string, mediaId: string): Promise<string | null> {
  // Whapi's GET /media/{id} returns raw binary, not JSON with a URL.
  // This function cannot work as designed. Use downloadMediaById() instead.
  return null;
}

export async function forwardMessage(channelToken: string, messageId: string, to: string): Promise<unknown> {
  const gate = gateApi(channelToken);
  const { data } = await gate.post(`/messages/${messageId}`, { to });
  return data;
}
