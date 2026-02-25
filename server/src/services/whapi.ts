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

async function getOrCreateProjectId(): Promise<string> {
  const { data: projects } = await managerApi.get('/projects');
  if (Array.isArray(projects) && projects.length > 0) {
    return projects[0].id;
  }
  const { data: newProject } = await managerApi.put('/projects', {
    name: 'Reply Flow',
  });
  return newProject.id;
}

export async function createChannel(name: string): Promise<WhapiChannel> {
  const projectId = await getOrCreateProjectId();
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
}

export async function deleteChannel(channelId: string): Promise<void> {
  await managerApi.delete(`/channels/${channelId}`);
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
