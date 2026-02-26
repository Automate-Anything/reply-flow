export interface WhapiChannel {
  id: string;
  token: string;
  name: string;
  status: string;
}

export interface WhapiQRResponse {
  qr: string;
  // base64-encoded QR code image or URL
}

export interface WhapiHealthResponse {
  status: {
    code: number;
    text: string; // 'INIT', 'AUTH', 'STOP', 'SYNC_ERROR'
  };
  version?: string;
  phone?: string;
  channel_id?: string;
}

export interface WhapiWebhookSettings {
  webhooks: Array<{
    url: string;
    events: Array<{ type: string; method: string }>;
  }>;
}
