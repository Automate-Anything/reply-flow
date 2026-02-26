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
    console.log('WhAPI channel created:', JSON.stringify(data, null, 2));
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

export async function listChannels(): Promise<unknown> {
  const { data } = await managerApi.get('/channels');
  return data;
}

export async function deleteChannel(channelId: string): Promise<void> {
  await managerApi.delete(`/channels/${channelId}`);
}

export async function getQR(channelToken: string, retries = 3): Promise<string> {
  const gate = gateApi(channelToken);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await gate.get('/users/login');
      return data.qr ?? data.image;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        const status = err.response.status;
        // Retry on 404 — channel may still be provisioning
        if (status === 404 && attempt < retries) {
          console.log(`WhAPI QR attempt ${attempt}/${retries} got 404, retrying in 3s...`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const detail = err.response.data?.message || err.response.data?.error || JSON.stringify(err.response.data);
        const error = new Error(`WhAPI QR error (${status}): ${detail}`);
        (error as Error & { statusCode: number }).statusCode = status;
        throw error;
      }
      throw err;
    }
  }
  throw new Error('Failed to get QR code after retries');
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
