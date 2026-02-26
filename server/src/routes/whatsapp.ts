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

// Cancel provisioning: deletes all pending channels for the user.
// Used when the client aborts a create-channel request and doesn't have
// the specific channel ID to delete.
router.post('/cancel-provisioning', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data: pendingChannels, error } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_token')
      .eq('user_id', userId)
      .eq('channel_status', 'pending');

    if (error) throw error;

    // Delete each pending channel from WhAPI and DB
    for (const ch of pendingChannels || []) {
      try { await whapi.logoutChannel(ch.channel_token); } catch { /* ignore */ }
      try { await whapi.deleteChannel(ch.channel_id); } catch { /* ignore */ }
      await supabaseAdmin
        .from('whatsapp_channels')
        .delete()
        .eq('id', ch.id)
        .eq('user_id', userId);
    }

    res.json({ deleted: (pendingChannels || []).length });
  } catch (err) {
    next(err);
  }
});

// Refresh QR code for an existing channel
router.get('/create-qr', async (req, res) => {
  const userId = req.userId!;
  const { channelId } = req.query;

  if (!channelId) {
    res.status(400).json({ error: 'channelId query param is required' });
    return;
  }

  try {
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

    try {
      const qrData = await whapi.getQR(channel.channel_token);
      res.json({ qr: qrData.qr, expire: qrData.expire });
    } catch (err: unknown) {
      // 409 = "channel already authenticated" — the channel is connected
      const is409 =
        (err as { response?: { status?: number } })?.response?.status === 409;

      if (is409) {
        // Update DB status to connected
        await supabaseAdmin
          .from('whatsapp_channels')
          .update({ channel_status: 'connected', updated_at: new Date().toISOString() })
          .eq('id', Number(channelId))
          .eq('user_id', userId);

        // Register webhook while we're here
        try {
          const webhookUrl = `${env.BACKEND_URL}/api/whatsapp/webhook`;
          await whapi.registerWebhook(channel.channel_token, webhookUrl);
          await supabaseAdmin
            .from('whatsapp_channels')
            .update({ webhook_registered: true })
            .eq('id', Number(channelId));
        } catch {
          // Best-effort webhook registration
        }

        res.json({ connected: true });
        return;
      }

      throw err;
    }
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
      .select('channel_token, channel_id, channel_status')
      .eq('id', Number(channelId))
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    // For pending channels, check if provisioning is done
    if (channel.channel_status === 'pending') {
      try {
        // wakeup=true nudges WhAPI to finish provisioning faster
        const health = await whapi.checkHealth(channel.channel_token, true);

        // 200 response means the gate is ready — update status
        // WhAPI status text: INIT, AUTH (connected), STOP, SYNC_ERROR
        const statusText = health.status?.text?.toUpperCase() || '';
        const isConnected = statusText === 'AUTH';
        const newStatus = isConnected ? 'connected' : 'awaiting_scan';

        await supabaseAdmin
          .from('whatsapp_channels')
          .update({
            channel_status: newStatus,
            ...(isConnected ? { phone_number: health.phone || null } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', Number(channelId));

        if (isConnected) {
          const webhookUrl = `${env.BACKEND_URL}/api/whatsapp/webhook`;
          await whapi.registerWebhook(channel.channel_token, webhookUrl);
          await supabaseAdmin
            .from('whatsapp_channels')
            .update({ webhook_registered: true })
            .eq('id', Number(channelId));
        }

        res.json({ status: newStatus, phone: health.phone || null });
      } catch {
        // Gate not ready yet — still provisioning
        res.json({ status: 'pending' });
      }
      return;
    }

    const health = await whapi.checkHealth(channel.channel_token);

    // WhAPI status text: INIT, AUTH (connected), STOP, SYNC_ERROR
    const statusText = health.status?.text?.toUpperCase() || '';
    const isConnected = statusText === 'AUTH';

    if (isConnected && channel.channel_status !== 'connected') {
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
      status: isConnected ? 'connected' : channel.channel_status,
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
