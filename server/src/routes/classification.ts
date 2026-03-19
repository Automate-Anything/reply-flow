import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { classifyConversation, acceptSuggestion, dismissSuggestion } from '../services/classification.js';

const router = Router();
router.use(requireAuth);

// In-memory rate limit: sessionId -> last classify timestamp
const classifyRateLimit = new Map<string, number>();

// Clean up entries older than 60 seconds every 60 seconds
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of classifyRateLimit.entries()) {
    if (ts < cutoff) classifyRateLimit.delete(key);
  }
}, 60_000);

// POST /classify/:sessionId — manually trigger classification
router.post('/classify/:sessionId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const sessionId = req.params.sessionId as string;

    const last = classifyRateLimit.get(sessionId);
    if (last && Date.now() - last < 5_000) {
      res.status(429).json({ error: 'Too many classification requests. Please wait a moment.' });
      return;
    }
    classifyRateLimit.set(sessionId, Date.now());

    const suggestion = await classifyConversation(sessionId, companyId, 'manual');
    if (suggestion === null) {
      res.status(422).json({ error: 'Classification not available for this conversation.' });
      return;
    }

    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
});

// GET /suggestions/:sessionId — list suggestions for a session
router.get('/suggestions/:sessionId', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const sessionId = req.params.sessionId as string;

    const { data, error } = await supabaseAdmin
      .from('classification_suggestions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ suggestions: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /suggestions/:suggestionId/accept — accept a suggestion
router.post('/suggestions/:suggestionId/accept', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const suggestionId = req.params.suggestionId as string;

    await acceptSuggestion(suggestionId, req.userId!, companyId);
    res.json({ status: 'ok' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Suggestion not found.' });
      return;
    }
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Conflict: suggestion already actioned.' });
      return;
    }
    next(err);
  }
});

// POST /suggestions/:suggestionId/dismiss — dismiss a suggestion
router.post('/suggestions/:suggestionId/dismiss', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const suggestionId = req.params.suggestionId as string;

    await dismissSuggestion(suggestionId, companyId);
    res.json({ status: 'ok' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Suggestion not found.' });
      return;
    }
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Conflict: suggestion already actioned.' });
      return;
    }
    next(err);
  }
});

// POST /suggestions/:suggestionId/accept-partial — accept a partial subset of suggestion fields
router.post('/suggestions/:suggestionId/accept-partial', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const suggestionId = req.params.suggestionId as string;
    const { accept } = req.body as { accept?: unknown };

    if (!accept || typeof accept !== 'object' || Array.isArray(accept)) {
      res.status(400).json({ error: '`accept` must be a non-null object.' });
      return;
    }

    const a = accept as Record<string, unknown>;
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === 'string');

    if (
      (a.labels !== undefined && !isStringArray(a.labels)) ||
      (a.priority !== undefined && typeof a.priority !== 'boolean') ||
      (a.status !== undefined && typeof a.status !== 'boolean') ||
      (a.contact_tags !== undefined && !isStringArray(a.contact_tags)) ||
      (a.contact_lists !== undefined && !isStringArray(a.contact_lists))
    ) {
      res.status(400).json({ error: 'Invalid `accept` shape. Expected { labels?: string[], priority?: boolean, status?: boolean, contact_tags?: string[], contact_lists?: string[] }.' });
      return;
    }

    await acceptSuggestion(suggestionId, req.userId!, companyId, a as import('../types/index.js').PartialAccept);
    res.json({ status: 'ok' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Suggestion not found.' });
      return;
    }
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Conflict: suggestion already actioned.' });
      return;
    }
    next(err);
  }
});

// GET /company-settings — get all company classification config
router.get('/company-settings', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('classification_enabled, classification_mode, classification_auto_classify, classification_rules, classification_config_mode, classification_structured_rules')
      .eq('id', companyId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PUT /company-settings — update company classification config
router.put('/company-settings', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { classification_enabled, classification_mode, classification_auto_classify, classification_rules, classification_config_mode, classification_structured_rules } = req.body;

    const update: Record<string, unknown> = {};
    if (typeof classification_enabled === 'boolean') update.classification_enabled = classification_enabled;
    if (classification_mode === 'suggest' || classification_mode === 'auto_apply') update.classification_mode = classification_mode;
    if (typeof classification_auto_classify === 'boolean') update.classification_auto_classify = classification_auto_classify;
    if (typeof classification_rules === 'string') update.classification_rules = classification_rules;
    if (classification_config_mode === 'company' || classification_config_mode === 'per_channel') update.classification_config_mode = classification_config_mode;
    if (Array.isArray(classification_structured_rules)) update.classification_structured_rules = classification_structured_rules;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const { error } = await supabaseAdmin.from('companies').update(update).eq('id', companyId);
    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /channel-settings/:channelId — get channel classification config
router.get('/channel-settings/:channelId', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = req.params.channelId as string;

    const { data, error } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('classification_override, classification_mode, classification_auto_classify, classification_rules, classification_structured_rules')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .single();

    if (error) throw error;
    res.json(data || { classification_override: 'company_defaults', classification_mode: null, classification_auto_classify: null, classification_rules: null });
  } catch (err) {
    next(err);
  }
});

// PUT /channel-settings/:channelId — update channel classification config
router.put('/channel-settings/:channelId', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = req.params.channelId as string;
    const { classification_override, classification_mode, classification_auto_classify, classification_rules, classification_structured_rules } = req.body;

    const update: Record<string, unknown> = {};
    if (['company_defaults', 'custom', 'disabled'].includes(classification_override)) update.classification_override = classification_override;
    if (classification_mode === 'suggest' || classification_mode === 'auto_apply' || classification_mode === null) update.classification_mode = classification_mode;
    if (typeof classification_auto_classify === 'boolean' || classification_auto_classify === null) update.classification_auto_classify = classification_auto_classify;
    if (typeof classification_rules === 'string' || classification_rules === null) update.classification_rules = classification_rules;
    if (Array.isArray(classification_structured_rules) || classification_structured_rules === null) update.classification_structured_rules = classification_structured_rules ?? [];

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('channel_agent_settings')
      .update(update)
      .eq('channel_id', channelId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /status/:sessionId — resolved config + channel info for the AI tab
router.get('/status/:sessionId', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const sessionId = req.params.sessionId as string;

    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const { data: companyData } = await supabaseAdmin
      .from('companies')
      .select('classification_enabled, classification_mode, classification_auto_classify, classification_config_mode')
      .eq('id', companyId)
      .single();

    const configMode = (companyData?.classification_config_mode as string) ?? 'company';

    const { data: channelSettingsData } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('classification_override, classification_mode, classification_auto_classify')
      .eq('channel_id', session.channel_id)
      .eq('company_id', companyId)
      .single();

    let enabled: boolean;
    let mode: string;

    if (configMode === 'per_channel') {
      const override = channelSettingsData?.classification_override ?? 'disabled';
      enabled = !!companyData?.classification_enabled && override === 'custom';
      mode = channelSettingsData?.classification_mode ?? 'suggest';
    } else {
      enabled = !!companyData?.classification_enabled;
      mode = companyData?.classification_mode ?? 'suggest';
    }

    res.json({
      enabled,
      channel_id: session.channel_id,
      mode,
      config_mode: configMode,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
