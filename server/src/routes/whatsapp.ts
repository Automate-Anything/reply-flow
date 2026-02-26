import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as whapi from '../services/whapi.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// DEBUG: List all channels on WhAPI (remove after debugging)
router.get('/debug-channels', async (_req, res) => {
  try {
    const channels = await whapi.listChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Create a WhatsApp channel for the user
router.post('/create-channel', async (req, res) => {
  try {
    const userId = req.userId!;

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

    const channel = await whapi.createChannel(`reply-flow-${userId.slice(0, 8)}`);

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

    res.json({ channelId: channel.id, status: 'pending' });
  } catch (err) {
    console.error('Create channel failed:', err instanceof Error ? err.message : err);
    const message = err instanceof Error ? err.message : 'Failed to create channel';
    res.status(500).json({ error: message });
  }
});

// Get QR code for the user's channel
router.get('/create-qr', async (req, res) => {
  try {
    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token, created_at')
      .eq('user_id', userId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'No channel found' });
      return;
    }

    // Give more retries to freshly created channels (< 2 min old)
    const ageMs = Date.now() - new Date(channel.created_at).getTime();
    const isNew = ageMs < 120_000;
    const qr = await whapi.getQR(channel.channel_token, isNew ? 6 : 3);

    if (!qr) {
      res.status(502).json({ error: 'QR code not available from WhatsApp provider' });
      return;
    }
    res.json({ qr });
  } catch (err) {
    console.error('QR fetch failed:', err instanceof Error ? err.message : err);
    const userId = req.userId!;
    const statusCode = (err as Error & { statusCode?: number }).statusCode;

    if (statusCode === 404) {
      // Check channel age — only auto-delete if it's old (truly stale)
      const { data: ch } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('created_at')
        .eq('user_id', userId)
        .single();

      const ageMs = ch ? Date.now() - new Date(ch.created_at).getTime() : Infinity;
      if (ageMs > 120_000) {
        await supabaseAdmin
          .from('whatsapp_channels')
          .delete()
          .eq('user_id', userId);
        res.status(404).json({ error: 'Channel expired. Please create a new connection.', stale: true });
        return;
      }

      // Channel is new but not ready yet — tell user to wait
      res.status(503).json({ error: 'Channel is still being provisioned. Please wait a moment and try again.' });
      return;
    }

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
      // Update status and register webhook if not done
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
