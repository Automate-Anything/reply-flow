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
    const companyId = req.user!.company_id;

    const { data: channel, error } = await supabaseAdmin
      .from('channels')
      .insert({
        company_id: companyId,
        created_by: req.user!.id,
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
      .eq('channel_type', 'email');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
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
    const { channelId, companyId } = JSON.parse(decoded.payload);

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
    });
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels/${channelId}?connected=true`);
  } catch (err) {
    console.error('[gmail] callback error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/channels?error=gmail_connection_failed`);
  }
}
