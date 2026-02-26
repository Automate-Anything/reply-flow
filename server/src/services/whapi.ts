import axios from 'axios';
import { env } from '../config/env.js';
import type { WhapiChannel, WhapiHealthResponse } from '../types/whapi.js';

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
      const detail = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
      throw new Error(`WhAPI create channel error (${status}): ${detail}`);
    }
    throw err;
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
      const detail = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
      throw new Error(`WhAPI extend channel error (${status}): ${detail}`);
    }
    throw err;
  }
}

export async function deleteChannel(channelId: string): Promise<void> {
  try {
    await managerApi.delete(`/channels/${channelId}`);
  } catch (err: unknown) {
    // Ignore 404 — channel already gone
    if (axios.isAxiosError(err) && err.response?.status === 404) return;
    throw err;
  }
}

/**
 * Check if a channel is ready on the Gate API.
 * Uses ?wakeup=true to trigger initialization.
 * Returns the health data if ready, or null if still provisioning (404).
 */
export async function checkChannelReady(channelToken: string): Promise<WhapiHealthResponse | null> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get('/health', { params: { wakeup: true } });
    return data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null; // Not provisioned yet
    }
    throw err;
  }
}

export async function getQR(channelToken: string): Promise<string> {
  const gate = gateApi(channelToken);
  try {
    const { data } = await gate.get('/users/login');
    return data.qr ?? data.image;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      const detail = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
      throw new Error(`WhAPI QR error (${status}): ${detail}`);
    }
    throw err;
  }
}

export async function checkHealth(
  channelToken: string
): Promise<WhapiHealthResponse> {
  const gate = gateApi(channelToken);
  const { data } = await gate.get('/health');
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

export async function logoutChannel(channelToken: string): Promise<void> {
  const gate = gateApi(channelToken);
  await gate.post('/users/logout');
}

export async function sendTextMessage(
  channelToken: string,
  to: string,
  body: string
): Promise<unknown> {
  const gate = gateApi(channelToken);
  const { data } = await gate.post('/messages/text', { to, body });
  return data;
}
