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
    text: string;
    // 'connected', 'loading', etc.
  };
  phone?: string;
}

export interface WhapiWebhookSettings {
  webhooks: Array<{
    url: string;
    events: Array<{ type: string; method: string }>;
  }>;
}
