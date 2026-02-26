import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as whapi from '../services/whapi.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// Create a WhatsApp channel and fund it. Returns immediately after DB insert.
// Provisioning continues in the background — the client polls /health-check.
router.post('/create-channel', async (req, res) => {
  const userId = req.userId!;

  try {
    // 1. Create channel on WhAPI
    const channel = await whapi.createChannel(`reply-flow-${userId.slice(0, 8)}-${Date.now()}`);

    // 2. Fund the channel with 1 day so it becomes active
    try {
      await whapi.extendChannel(channel.id, 1);
    } catch (err) {
      // Clean up the orphaned channel on WhAPI if funding fails
      await whapi.deleteChannel(channel.id).catch(() => {});
      throw err;
    }

    // 3. Save to DB with pending status
    const { data: insertedRow, error: dbError } = await supabaseAdmin
      .from('whatsapp_channels')
      .insert({
        user_id: userId,
        channel_id: channel.id,
        channel_token: channel.token,
        channel_name: channel.name,
        channel_status: 'pending',
      })
      .select('id')
      .single();

    if (dbError || !insertedRow) throw dbError || new Error('Failed to insert channel');

    // 4. Return immediately — client will poll /health-check for provisioning status
    res.json({ dbChannelId: insertedRow.id });

    // 5. Fire-and-forget: wait for provisioning, then update DB status
    whapi.waitForReady(channel.token, 120_000)
      .then(async () => {
        await supabaseAdmin
          .from('whatsapp_channels')
          .update({ channel_status: 'awaiting_scan', updated_at: new Date().toISOString() })
          .eq('id', insertedRow.id);
      })
      .catch((err) => {
        console.error('Background provisioning failed:', err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.error('Create channel failed:', err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : 'Failed to create channel';
    if (!res.headersSent) res.status(500).json({ error: message });
  }
});

// Refresh QR code for an existing channel
router.get('/create-qr', async (req, res) => {
  try {
    const userId = req.userId!;
    const { channelId } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'channelId query param is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', Number(channelId))
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    const qrData = await whapi.getQR(channel.channel_token);
    res.json({ qr: qrData.qr, expire: qrData.expire });
  } catch (err) {
    console.error('QR fetch failed:', err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : 'Failed to fetch QR code';
    res.status(502).json({ error: message });
  }
});

// Check health / connection status for a specific channel
router.get('/health-check', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { channelId } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'channelId query param is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token, channel_id')
      .eq('id', Number(channelId))
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    const health = await whapi.checkHealth(channel.channel_token);
    const isConnected = health.status?.text === 'connected';

    if (isConnected) {
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({
          channel_status: 'connected',
          phone_number: health.phone || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', Number(channelId));

      // Register webhook
      const webhookUrl = `${env.BACKEND_URL}/api/whatsapp/webhook`;
      await whapi.registerWebhook(channel.channel_token, webhookUrl);
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({ webhook_registered: true })
        .eq('id', Number(channelId));
    }

    res.json({
      status: isConnected ? 'connected' : 'pending',
      phone: health.phone || null,
    });
  } catch (err) {
    next(err);
  }
});

// Get all channels for the user
router.get('/channels', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: channels, error } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_name, channel_status, phone_number, webhook_registered, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ channels: channels || [] });
  } catch (err) {
    next(err);
  }
});

// Get a single channel by ID
router.get('/channels/:channelId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { channelId } = req.params;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_name, channel_status, phone_number, webhook_registered, created_at')
      .eq('id', Number(channelId))
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.json({ channel });
  } catch (err) {
    next(err);
  }
});

// Logout / disconnect WhatsApp for a specific channel
router.post('/logout', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { channelId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', channelId)
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    await whapi.logoutChannel(channel.channel_token);

    await supabaseAdmin
      .from('whatsapp_channels')
      .update({
        channel_status: 'disconnected',
        webhook_registered: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId);

    res.json({ status: 'disconnected' });
  } catch (err) {
    next(err);
  }
});

// Delete channel entirely
router.delete('/delete-channel', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { channelId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_token')
      .eq('id', channelId)
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    // Logout first, ignore errors
    try {
      await whapi.logoutChannel(channel.channel_token);
    } catch {
      // Channel may already be logged out
    }

    await whapi.deleteChannel(channel.channel_id);

    await supabaseAdmin
      .from('whatsapp_channels')
      .delete()
      .eq('id', channelId)
      .eq('user_id', userId);

    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
