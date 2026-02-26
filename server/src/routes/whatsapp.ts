import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as whapi from '../services/whapi.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// In-memory map of userId → AbortController for in-flight provisioning requests
const provisioningControllers = new Map<string, AbortController>();

// Create a WhatsApp channel, fund it, wait for provisioning, return QR.
// This is a long-running request (up to ~2 min) — the client should use a long timeout.
router.post('/create-channel', async (req, res) => {
  const userId = req.userId!;
  const controller = new AbortController();
  provisioningControllers.set(userId, controller);

  try {
    // Check if user already has a channel
    const { data: existing } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      res.status(400).json({ error: 'Channel already exists' });
      return;
    }

    // 1. Create channel on WhAPI
    const channel = await whapi.createChannel(`reply-flow-${userId.slice(0, 8)}`);

    // 2. Fund the channel with 1 day so it becomes active
    try {
      await whapi.extendChannel(channel.id, 1);
    } catch (err) {
      // Clean up the orphaned channel on WhAPI if funding fails
      await whapi.deleteChannel(channel.id).catch(() => {});
      throw err;
    }

    // 3. Save to DB immediately (so user can delete if they cancel)
    const { error: dbError } = await supabaseAdmin
      .from('whatsapp_channels')
      .insert({
        user_id: userId,
        channel_id: channel.id,
        channel_token: channel.token,
        channel_name: channel.name,
        channel_status: 'pending',
      });

    if (dbError) throw dbError;

    // 4. Wait for channel to finish provisioning on WhAPI Gate API (up to 2 min)
    await whapi.waitForReady(channel.token, 120_000, controller.signal);

    // 5. Mark channel as ready for QR scanning
    await supabaseAdmin
      .from('whatsapp_channels')
      .update({ channel_status: 'awaiting_scan', updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    // 6. Get QR code
    const qrData = await whapi.getQR(channel.token);

    res.json({
      channelId: channel.id,
      qr: qrData.qr,
      expire: qrData.expire,
    });
  } catch (err) {
    // If cancelled, the cancel endpoint already handled cleanup — just return quietly
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (!res.headersSent) res.status(499).json({ error: 'Provisioning cancelled' });
      return;
    }
    console.error('Create channel failed:', err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : 'Failed to create channel';
    if (!res.headersSent) res.status(500).json({ error: message });
  } finally {
    provisioningControllers.delete(userId);
  }
});

// Cancel an in-flight channel provisioning
router.post('/cancel-provisioning', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Abort the in-flight provisioning request
    const controller = provisioningControllers.get(userId);
    if (controller) controller.abort();

    // Clean up: delete channel from Whapi and DB if it was already created
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_token')
      .eq('user_id', userId)
      .single();

    if (channel) {
      try { await whapi.logoutChannel(channel.channel_token); } catch { /* ignore */ }
      await whapi.deleteChannel(channel.channel_id);
      await supabaseAdmin
        .from('whatsapp_channels')
        .delete()
        .eq('user_id', userId);
    }

    res.json({ status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

// Refresh QR code for an existing channel
router.get('/create-qr', async (req, res) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
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

// Check health / connection status
router.get('/health-check', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token, channel_id')
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
        .eq('user_id', userId);

      // Register webhook
      const webhookUrl = `${env.BACKEND_URL}/api/whatsapp/webhook`;
      await whapi.registerWebhook(channel.channel_token, webhookUrl);
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({ webhook_registered: true })
        .eq('user_id', userId);
    }

    res.json({
      status: isConnected ? 'connected' : 'pending',
      phone: health.phone || null,
    });
  } catch (err) {
    next(err);
  }
});

// Get current channel info
router.get('/channel', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_name, channel_status, phone_number, webhook_registered, created_at')
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.json({ channel: null });
      return;
    }

    res.json({ channel });
  } catch (err) {
    next(err);
  }
});

// Logout / disconnect WhatsApp
router.post('/logout', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
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
      .eq('user_id', userId);

    res.json({ status: 'disconnected' });
  } catch (err) {
    next(err);
  }
});

// Delete channel entirely
router.delete('/delete-channel', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_token')
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
      .eq('user_id', userId);

    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
