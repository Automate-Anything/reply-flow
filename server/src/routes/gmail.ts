import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as gmail from '../services/gmail.js';

const router = Router();
router.use(requireAuth);

// POST /api/channels/gmail/connect — Start OAuth flow
router.post('/connect', requirePermission('channels', 'create'), async (req, res) => {
  try {
    const { channelName } = req.body;
    const companyId = req.companyId!;

    const { data: channel, error } = await supabaseAdmin
      .from('channels')
      .insert({
        company_id: companyId,
        user_id: req.userId!,
        created_by: req.userId!,
        channel_type: 'email',
        channel_name: channelName || 'Gmail',
        channel_status: 'pending',
      })
      .select('id')
      .single();

    if (error) throw error;

    const statePayload = JSON.stringify({ channelId: channel.id, companyId, ts: Date.now() });
    const hmac = crypto.createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
      .update(statePayload).digest('hex');
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: hmac })).toString('base64');
    const authUrl = gmail.getAuthUrl(state);

    res.json({ authUrl, channelId: channel.id });
  } catch (err) {
    console.error('[gmail] connect error:', err);
    res.status(500).json({ error: 'Failed to start Gmail connection' });
  }
});

// GET /api/channels/gmail/channels/:id/status
router.get('/channels/:id/status', requirePermission('channels', 'view'), async (req, res) => {
  try {
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('id, channel_status, email_address, gmail_watch_expiry, oauth_token_expiry')
      .eq('id', req.params.id)
      .eq('company_id', req.companyId!)
      .eq('channel_type', 'email')
      .single();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const watchExpired = channel.gmail_watch_expiry
      ? new Date(channel.gmail_watch_expiry) < new Date()
      : true;

    res.json({
      status: channel.channel_status,
      email: channel.email_address,
      watchActive: !watchExpired,
      tokenExpiry: channel.oauth_token_expiry,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// POST /api/channels/gmail/channels/:id/disconnect
router.post('/channels/:id/disconnect', requirePermission('channels', 'edit'), async (req, res) => {
  try {
    await supabaseAdmin
      .from('channels')
      .update({
        channel_status: 'disconnected',
        oauth_access_token: null,
        oauth_refresh_token: null,
        webhook_registered: false,
      })
      .eq('id', req.params.id)
      .eq('company_id', req.companyId!)
      .eq('channel_type', 'email');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// POST /api/channels/gmail/channels/:id/sync — Historical email sync
router.post('/channels/:id/sync', requirePermission('channels', 'edit'), async (req, res) => {
  try {
    const { period } = req.body; // '24h' | '7d' | '30d'
    const companyId = req.companyId!;

    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .eq('channel_type', 'email')
      .eq('channel_status', 'connected')
      .single();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.oauth_access_token || !channel.oauth_refresh_token) {
      return res.status(400).json({ error: 'Channel not authenticated' });
    }

    const hoursMap: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 };
    const hours = hoursMap[period] || 24;
    const after = new Date(Date.now() - hours * 60 * 60 * 1000);

    const gmailClient = gmail.getGmailClient({
      access_token: channel.oauth_access_token,
      refresh_token: channel.oauth_refresh_token,
    }, channel.id);

    // List messages in the time range
    const messageIds = await gmail.listMessages(gmailClient, { after, maxResults: 500 });

    // Respond immediately with the count — process in background
    res.json({ started: true, messageCount: messageIds.length, period });

    // Process messages in the background (after response is sent)
    const { processGmailMessageById } = await import('./gmailWebhook.js');
    let processed = 0;
    let skipped = 0;
    for (const messageId of messageIds) {
      try {
        const wasNew = await processGmailMessageById(gmailClient, channel, messageId);
        if (wasNew) processed++; else skipped++;
      } catch (err) {
        console.error(`[gmail-sync] Error processing ${messageId}:`, err);
      }
    }
    console.log(`[gmail-sync] Done for ${channel.email_address}: ${processed} new, ${skipped} skipped, ${messageIds.length} total`);
  } catch (err) {
    console.error('[gmail-sync] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start sync' });
    }
  }
});

export default router;

// OAuth callback — registered separately in index.ts (no auth middleware)
export async function handleGoogleCallback(req: any, res: any) {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const expectedSig = crypto.createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
      .update(decoded.payload).digest('hex');
    if (decoded.sig !== expectedSig) {
      return res.status(403).send('Invalid state signature');
    }
    const { channelId, companyId, ts } = JSON.parse(decoded.payload);

    // Reject states older than 15 minutes to prevent replay attacks
    if (ts && Date.now() - ts > 15 * 60 * 1000) {
      return res.status(400).send('OAuth state expired — please try connecting again');
    }

    const { data: pendingChannel } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .eq('channel_status', 'pending')
      .single();
    if (!pendingChannel) {
      return res.status(400).send('Invalid or expired channel connection');
    }

    const tokens = await gmail.exchangeCode(code as string);

    const gmailClient = gmail.getGmailClient({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    }, channelId);
    const watchResult = await gmail.registerWatch(gmailClient);

    await supabaseAdmin
      .from('channels')
      .update({
        email_address: tokens.email,
        display_identifier: tokens.email,
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_token_expiry: new Date(tokens.expiry_date).toISOString(),
        gmail_history_id: watchResult.historyId,
        gmail_watch_expiry: new Date(parseInt(watchResult.expiration)).toISOString(),
        channel_status: 'connected',
        webhook_registered: true,
      })
      .eq('id', channelId);

    await supabaseAdmin
      .from('channel_agent_settings')
      .upsert({
        channel_id: channelId,
        company_id: companyId,
        is_enabled: false,
      });

    const frontendUrl = env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels/${channelId}?connected=true`);
  } catch (err) {
    console.error('[gmail] callback error:', err);
    const frontendUrl = env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels?error=gmail_connection_failed`);
  }
}
