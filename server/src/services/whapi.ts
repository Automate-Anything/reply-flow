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
  const { data } = await managerApi.put('/channels', {
    name,
    plan: 'sandbox',
  });
  return {
    id: data.id,
    token: data.token,
    name: data.name,
    status: data.status,
  };
}

export async function deleteChannel(channelId: string): Promise<void> {
  await managerApi.delete(`/channels/${channelId}`);
}

export async function getQR(channelToken: string): Promise<string> {
  const gate = gateApi(channelToken);
  const { data } = await gate.get('/users/login');
  return data.qr ?? data.image;
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
