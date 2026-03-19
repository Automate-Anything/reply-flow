import { Router } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { checkRateLimit, check24HourWindow } from '../services/complianceUtils.js';

const router = Router();
router.use(requireAuth);

// ── Health weights ──────────────────────────────────────────────────────────

function computeHealthScore(params: {
  responseRate7d: number | null;
  rateLimitUtilization: number;
  riskFactor: number | null;
  riskFactorContacts: number | null;
  riskFactorChats: number | null;
  outboundCount7d: number;
}): { score: number; status: 'healthy' | 'needs_attention' | 'at_risk' | 'no_data' } {
  const { responseRate7d, rateLimitUtilization, riskFactor, riskFactorContacts, riskFactorChats, outboundCount7d } = params;

  if (outboundCount7d < 10) {
    return { score: 0, status: 'no_data' };
  }

  // Response rate (7d): 30% weight
  let responseRateScore = 0;
  if (responseRate7d !== null) {
    if (responseRate7d >= 30) responseRateScore = 1.0;
    else if (responseRate7d >= 15) responseRateScore = 0.5;
    else responseRateScore = 0.0;
  }

  // Rate limit utilization: 20% weight
  let rateLimitScore = 1.0;
  if (rateLimitUtilization >= 85) rateLimitScore = 0.0;
  else if (rateLimitUtilization >= 60) rateLimitScore = 0.5;

  // WhAPI risk_factor: 20% weight (3=good, 1=bad)
  let riskFactorScore = 0.5;
  if (riskFactor !== null) {
    if (riskFactor >= 3) riskFactorScore = 1.0;
    else if (riskFactor === 2) riskFactorScore = 0.5;
    else riskFactorScore = 0.0;
  }

  // WhAPI risk_factor_contacts: 15% weight
  let riskContactsScore = 0.5;
  if (riskFactorContacts !== null) {
    if (riskFactorContacts >= 3) riskContactsScore = 1.0;
    else if (riskFactorContacts === 2) riskContactsScore = 0.5;
    else riskContactsScore = 0.0;
  }

  // WhAPI risk_factor_chats: 15% weight
  let riskChatsScore = 0.5;
  if (riskFactorChats !== null) {
    if (riskFactorChats >= 3) riskChatsScore = 1.0;
    else if (riskFactorChats === 2) riskChatsScore = 0.5;
    else riskChatsScore = 0.0;
  }

  const score =
    responseRateScore * 0.30 +
    rateLimitScore    * 0.20 +
    riskFactorScore   * 0.20 +
    riskContactsScore * 0.15 +
    riskChatsScore    * 0.15;

  let status: 'healthy' | 'needs_attention' | 'at_risk';
  if (score >= 0.7) status = 'healthy';
  else if (score >= 0.4) status = 'needs_attention';
  else status = 'at_risk';

  return { score, status };
}

// ── GET /channels/health — all channels' health summary ────────────────────
// IMPORTANT: This static route MUST be registered before /channels/:channelId/...

router.get('/channels/health', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch all channels for this company
    const { data: channels, error: channelsErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_status')
      .eq('company_id', companyId);

    if (channelsErr) throw channelsErr;
    if (!channels || channels.length === 0) {
      res.json({ channels: [] });
      return;
    }

    const channelIds = channels.map((c: { id: number }) => c.id);

    // Fetch cached safety scores
    const { data: safetyScores } = await supabaseAdmin
      .from('channel_safety_scores')
      .select('channel_id, risk_factor, risk_factor_contacts, risk_factor_chats')
      .in('channel_id', channelIds);

    const safetyMap = new Map(
      (safetyScores ?? []).map((s: { channel_id: number; risk_factor: number | null; risk_factor_contacts: number | null; risk_factor_chats: number | null }) => [s.channel_id, s])
    );

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await Promise.all(
      channels.map(async (channel: { id: number; channel_status: string }) => {
        // Count outbound messages in last 7 days
        const { count: outboundCount } = await supabaseAdmin
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', channel.id)
          .eq('direction', 'outbound')
          .gte('created_at', sevenDaysAgo);

        // Count inbound replies in last 7 days
        const { count: inboundCount } = await supabaseAdmin
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', channel.id)
          .eq('direction', 'inbound')
          .gte('created_at', sevenDaysAgo);

        const outbound7d = outboundCount ?? 0;
        const inbound7d = inboundCount ?? 0;
        const responseRate7d = outbound7d > 0 ? (inbound7d / outbound7d) * 100 : null;

        // Rate limit utilization
        const rateLimitInfo = checkRateLimit(channel.id, companyId);
        const utilization = ((rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit) * 100;

        const safety = safetyMap.get(channel.id);
        const { score, status } = computeHealthScore({
          responseRate7d,
          rateLimitUtilization: utilization,
          riskFactor: safety?.risk_factor ?? null,
          riskFactorContacts: safety?.risk_factor_contacts ?? null,
          riskFactorChats: safety?.risk_factor_chats ?? null,
          outboundCount7d: outbound7d,
        });

        return {
          channelId: channel.id,
          channelStatus: channel.channel_status,
          healthScore: score,
          healthStatus: status,
          responseRate7d,
          rateLimitUtilization: utilization,
          riskFactor: safety?.risk_factor ?? null,
        };
      })
    );

    res.json({ channels: results });
  } catch (err) {
    next(err);
  }
});

// ── GET /channels/:channelId/rate-limit ────────────────────────────────────

router.get('/channels/:channelId/rate-limit', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    if (isNaN(channelId)) {
      res.status(400).json({ error: 'Invalid channelId' });
      return;
    }

    // Verify channel belongs to company
    const { data: channel, error: channelErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (channelErr) throw channelErr;
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const rateLimitInfo = checkRateLimit(channelId, companyId);
    const utilization = ((rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit) * 100;

    res.json({
      channelId,
      limit: rateLimitInfo.limit,
      remaining: rateLimitInfo.remaining,
      resetsAt: rateLimitInfo.resetsAt,
      utilization,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /channels/:channelId/health — detailed health score ────────────────

router.get('/channels/:channelId/health', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    if (isNaN(channelId)) {
      res.status(400).json({ error: 'Invalid channelId' });
      return;
    }

    // Verify channel belongs to company
    const { data: channel, error: channelErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_status')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (channelErr) throw channelErr;
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [outboundResult, inboundResult, safetyResult, groupCountResult] = await Promise.all([
      supabaseAdmin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('direction', 'outbound')
        .gte('created_at', sevenDaysAgo),
      supabaseAdmin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('direction', 'inbound')
        .gte('created_at', sevenDaysAgo),
      supabaseAdmin
        .from('channel_safety_scores')
        .select('risk_factor, risk_factor_contacts, risk_factor_chats, life_time, fetched_at')
        .eq('channel_id', channelId)
        .maybeSingle(),
      supabaseAdmin
        .from('group_chats')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('monitoring_enabled', true),
    ]);

    const outbound7d = outboundResult.count ?? 0;
    const inbound7d = inboundResult.count ?? 0;
    const responseRate7d = outbound7d > 0 ? (inbound7d / outbound7d) * 100 : null;

    const rateLimitInfo = checkRateLimit(channelId, companyId);
    const utilization = ((rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit) * 100;

    const safety = safetyResult.data;

    const { score, status } = computeHealthScore({
      responseRate7d,
      rateLimitUtilization: utilization,
      riskFactor: safety?.risk_factor ?? null,
      riskFactorContacts: safety?.risk_factor_contacts ?? null,
      riskFactorChats: safety?.risk_factor_chats ?? null,
      outboundCount7d: outbound7d,
    });

    res.json({
      channelId,
      channelStatus: channel.channel_status,
      healthScore: score,
      healthStatus: status,
      groupCount: groupCountResult.count ?? 0,
      breakdown: {
        responseRate7d,
        outbound7d,
        inbound7d,
        rateLimitUtilization: utilization,
        rateLimit: {
          limit: rateLimitInfo.limit,
          remaining: rateLimitInfo.remaining,
          resetsAt: rateLimitInfo.resetsAt,
        },
        whapi: safety
          ? {
              riskFactor: safety.risk_factor,
              riskFactorContacts: safety.risk_factor_contacts,
              riskFactorChats: safety.risk_factor_chats,
              lifeTime: safety.life_time,
              fetchedAt: safety.fetched_at,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /channels/:channelId/safety-meter — WhAPI safety meter (cached daily)

router.get('/channels/:channelId/safety-meter', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const forceRefresh = req.query.refresh === 'true';

    if (isNaN(channelId)) {
      res.status(400).json({ error: 'Invalid channelId' });
      return;
    }

    // Verify channel belongs to company and get token
    const { data: channel, error: channelErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_token')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (channelErr) throw channelErr;
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check cache unless forced refresh
    if (!forceRefresh) {
      const { data: cached } = await supabaseAdmin
        .from('channel_safety_scores')
        .select('risk_factor, risk_factor_contacts, risk_factor_chats, life_time, fetched_at')
        .eq('channel_id', channelId)
        .maybeSingle();

      if (cached?.fetched_at) {
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (age < twentyFourHours) {
          res.json({ cached: true, ...cached });
          return;
        }
      }
    }

    // Fetch from WhAPI tools endpoint using the channel's bearer token
    let whapiData: {
      risk_factor?: number;
      risk_factor_chats?: number;
      risk_factor_contacts?: number;
      life_time?: number;
    };
    try {
      const { data } = await axios.post(
        'https://tools.whapi.cloud/services/riskOfBlocking',
        {},
        {
          headers: {
            Authorization: `Bearer ${channel.channel_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      whapiData = data;
    } catch (apiErr) {
      if (axios.isAxiosError(apiErr) && apiErr.response) {
        res.status(502).json({
          error: 'WhAPI safety meter unavailable',
          detail: apiErr.response.data,
        });
      } else {
        next(apiErr);
      }
      return;
    }

    // Upsert into cache
    const { error: upsertErr } = await supabaseAdmin
      .from('channel_safety_scores')
      .upsert({
        channel_id: channelId,
        company_id: companyId,
        risk_factor: whapiData.risk_factor ?? null,
        risk_factor_chats: whapiData.risk_factor_chats ?? null,
        risk_factor_contacts: whapiData.risk_factor_contacts ?? null,
        life_time: whapiData.life_time ?? null,
        fetched_at: new Date().toISOString(),
      });

    if (upsertErr) throw upsertErr;

    res.json({
      cached: false,
      risk_factor: whapiData.risk_factor ?? null,
      risk_factor_chats: whapiData.risk_factor_chats ?? null,
      risk_factor_contacts: whapiData.risk_factor_contacts ?? null,
      life_time: whapiData.life_time ?? null,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /channels/:channelId/events — recent compliance events ─────────────

router.get('/channels/:channelId/events', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    if (isNaN(channelId)) {
      res.status(400).json({ error: 'Invalid channelId' });
      return;
    }

    // Verify channel belongs to company
    const { data: channel, error: channelErr } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (channelErr) throw channelErr;
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const { data: events, error: eventsErr } = await supabaseAdmin
      .from('compliance_metrics')
      .select('id, event_type, event_data, created_at')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventsErr) throw eventsErr;

    res.json({ events: events ?? [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /sessions/:sessionId/window-status — 24h window status ────────────

router.get('/sessions/:sessionId/window-status', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    // Verify session belongs to company
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (sessionErr) throw sessionErr;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const windowStatus = await check24HourWindow(sessionId);

    res.json({
      sessionId,
      channelId: session.channel_id,
      ...windowStatus,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
