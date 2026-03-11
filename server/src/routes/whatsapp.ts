import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as whapi from '../services/whapi.js';
import { checkPlanLimit } from './billing.js';

const router = Router();

async function syncConnectedChannelMetadata(
  companyId: string,
  channelId: number,
  channelToken: string,
  phone: string | null,
  whapiChannelId?: string
) {
  const userProfile = await whapi.getUserProfile(channelToken);
  const profilePictureUrl = userProfile?.icon_full || userProfile?.icon || null;
  const profileName = userProfile?.name || null;
  // Try health phone → user profile phone → manager API phone
  let resolvedPhone = phone || userProfile?.phone || null;
  if (!resolvedPhone && whapiChannelId) {
    resolvedPhone = await whapi.getChannelPhone(whapiChannelId);
  }

  await supabaseAdmin
    .from('whatsapp_channels')
    .update({
      channel_status: 'connected',
      phone_number: resolvedPhone,
      profile_picture_url: profilePictureUrl,
      profile_name: profileName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', channelId)
    .eq('company_id', companyId);

  return { profilePictureUrl, profileName };
}

// All routes require auth
router.use(requireAuth);

// Create a WhatsApp channel and fund it. Returns immediately after DB insert.
// Provisioning continues in the background — the client polls /health-check.
router.post('/create-channel', requirePermission('channels', 'create'), async (req, res) => {
  const companyId = req.companyId!;

  try {
    // 0. Enforce plan limit
    const limit = await checkPlanLimit(companyId, 'channels');
    if (!limit.allowed) {
      res.status(402).json({ error: 'Channel limit reached', used: limit.used, included: limit.included });
      return;
    }

    // 1. Create channel on WhAPI
    const channelName = req.body.name?.trim() || `reply-flow-${req.userId!.slice(0, 8)}-${Date.now()}`;
    const channel = await whapi.createChannel(channelName);

    // 3. Save to DB with pending status
    const { data: insertedRow, error: dbError } = await supabaseAdmin
      .from('whatsapp_channels')
      .insert({
        company_id: companyId,
        user_id: req.userId,
        created_by: req.userId,
        channel_id: channel.id,
        channel_token: channel.token,
        channel_name: channel.name,
        channel_status: 'pending',
      })
      .select('id')
      .single();

    if (dbError || !insertedRow) throw dbError || new Error('Failed to insert channel');

    // 4. Auto-create channel AI settings from company template
    try {
      const { data: template } = await supabaseAdmin
        .from('company_ai_profiles')
        .select('is_enabled, profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message')
        .eq('company_id', companyId)
        .single();

      await supabaseAdmin
        .from('channel_agent_settings')
        .insert({
          channel_id: insertedRow.id,
          company_id: companyId,
          is_enabled: template?.is_enabled ?? true,
          profile_data: template?.profile_data ?? {},
          max_tokens: template?.max_tokens ?? 500,
          schedule_mode: template?.schedule_mode ?? 'always_on',
          ai_schedule: template?.ai_schedule ?? null,
          outside_hours_message: template?.outside_hours_message ?? null,
        });
    } catch (err) {
      console.error('Failed to create channel AI settings:', err);
      // Non-fatal: channel works, AI settings can be configured later
    }

    // 4b. Extend the channel based on subscription status so it starts funded
    try {
      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('status, trial_ends_at')
        .eq('company_id', companyId)
        .maybeSingle();

      let extensionDays = 0;
      if (sub?.status === 'trialing' && sub.trial_ends_at) {
        const msRemaining = new Date(sub.trial_ends_at).getTime() - Date.now();
        extensionDays = Math.max(1, Math.ceil(msRemaining / 86_400_000));
      } else if (sub?.status === 'active') {
        extensionDays = 30;
      }

      if (extensionDays > 0) {
        await whapi.extendChannel(channel.id, extensionDays);
        console.log(`Extended new channel ${channel.id} by ${extensionDays} days`);
      }
    } catch (err) {
      console.error('Failed to extend channel on creation (non-fatal):', err instanceof Error ? err.message : err);
    }

    // 5. Return immediately — client will poll /health-check for provisioning status
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
router.post('/cancel-provisioning', requirePermission('channels', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data: pendingChannels, error } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_token')
      .eq('company_id', companyId)
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
        .eq('company_id', companyId);
    }

    res.json({ deleted: (pendingChannels || []).length });
  } catch (err) {
    next(err);
  }
});

// Refresh QR code for an existing channel
router.get('/create-qr', requirePermission('channels', 'edit'), async (req, res) => {
  const companyId = req.companyId!;
  const { channelId } = req.query;

  if (!channelId) {
    res.status(400).json({ error: 'channelId query param is required' });
    return;
  }

  try {
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token, channel_id')
      .eq('id', Number(channelId))
      .eq('company_id', companyId)
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
        // Get phone number from health check
        let phone: string | null = null;
        try {
          const health = await whapi.checkHealth(channel.channel_token);
          phone = health.phone || null;
        } catch { /* best effort */ }

        // Fetch the connected user's own profile (name + picture)
        await syncConnectedChannelMetadata(
          companyId,
          Number(channelId),
          channel.channel_token,
          phone,
          channel.channel_id
        );

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
router.get('/health-check', requirePermission('channels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channelId } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'channelId query param is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token, channel_id, channel_status, phone_number, profile_picture_url, profile_name, webhook_registered')
      .eq('id', Number(channelId))
      .eq('company_id', companyId)
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

        if (isConnected) {
          await syncConnectedChannelMetadata(
            companyId,
            Number(channelId),
            channel.channel_token,
            health.phone || null,
            channel.channel_id
          );
        } else {
          await supabaseAdmin
            .from('whatsapp_channels')
            .update({
              channel_status: newStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', Number(channelId));
        }

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

    // Skip provider health check for demo channels
    if (channel.channel_token === 'demo-token') {
      res.json({ status: channel.channel_status, phone: null });
      return;
    }

    let health;
    try {
      health = await whapi.checkHealth(channel.channel_token);
    } catch {
      // Provider API failed — don't change DB status on transient failures,
      // just report what we have in the DB
      res.json({ status: channel.channel_status, phone: null });
      return;
    }

    // WhAPI status text: INIT, AUTH (connected), STOP, SYNC_ERROR
    const statusText = health.status?.text?.toUpperCase() || '';
    const isConnected = statusText === 'AUTH';

    const shouldSyncConnectedMetadata =
      isConnected && (
        channel.channel_status !== 'connected' ||
        !channel.phone_number ||
        !channel.profile_picture_url ||
        !channel.profile_name
      );

    if (shouldSyncConnectedMetadata) {
      await syncConnectedChannelMetadata(
        companyId,
        Number(channelId),
        channel.channel_token,
        health.phone || null,
        channel.channel_id
      );

      if (!channel.webhook_registered) {
        const webhookUrl = `${env.BACKEND_URL}/api/whatsapp/webhook`;
        await whapi.registerWebhook(channel.channel_token, webhookUrl);
        await supabaseAdmin
          .from('whatsapp_channels')
          .update({ webhook_registered: true })
          .eq('id', Number(channelId));
      }
    } else if (!isConnected && channel.channel_status === 'connected') {
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({ channel_status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('id', Number(channelId));
    }

    const resolvedStatus = isConnected ? 'connected' : (channel.channel_status === 'connected' ? 'disconnected' : channel.channel_status);
    res.json({
      status: resolvedStatus,
      phone: health.phone || null,
    });
  } catch (err) {
    next(err);
  }
});

// Get all channels the user can access (owned + shared)
router.get('/channels', requirePermission('channels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;

    // Import dynamically to avoid circular deps at module load
    const { getAccessibleChannelIds } = await import('../services/accessControl.js');
    const accessibleIds = await getAccessibleChannelIds(userId, companyId);

    if (accessibleIds.length === 0) {
      res.json({ channels: [] });
      return;
    }

    const { data: channels, error } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_name, channel_status, phone_number, profile_picture_url, profile_name, webhook_registered, created_at, user_id, sharing_mode, default_conversation_visibility')
      .in('id', accessibleIds)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Add is_owner flag for the client
    const enriched = (channels || []).map((ch) => ({
      ...ch,
      is_owner: ch.user_id === userId,
    }));

    res.json({ channels: enriched });
  } catch (err) {
    next(err);
  }
});

// Get a single channel by ID
router.get('/channels/:channelId', requirePermission('channels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channelId } = req.params;

    const userId = req.userId!;

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_name, channel_status, phone_number, profile_picture_url, profile_name, webhook_registered, created_at, user_id, sharing_mode, default_conversation_visibility')
      .eq('id', Number(channelId))
      .eq('company_id', companyId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.json({ channel: { ...channel, is_owner: channel.user_id === userId } });
  } catch (err) {
    next(err);
  }
});

// Logout / disconnect WhatsApp for a specific channel
router.post('/logout', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channelId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', channelId)
      .eq('company_id', companyId)
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
router.delete('/delete-channel', requirePermission('channels', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channelId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_token')
      .eq('id', channelId)
      .eq('company_id', companyId)
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
      .eq('company_id', companyId);

    res.json({ status: 'deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
