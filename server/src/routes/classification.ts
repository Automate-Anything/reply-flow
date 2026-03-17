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
    if (last && Date.now() - last < 30_000) {
      res.status(429).json({ error: 'Too many classification requests. Please wait 30 seconds.' });
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

    await acceptSuggestion(suggestionId, req.userId!, companyId, accept as Record<string, unknown>);
    res.json({ status: 'ok' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: 'Conflict: suggestion already actioned.' });
      return;
    }
    next(err);
  }
});

// GET /settings — get company classification mode
router.get('/settings', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('classification_mode')
      .eq('id', companyId)
      .single();

    if (error) throw error;

    res.json({ classification_mode: data?.classification_mode ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /settings — update company classification mode
router.put('/settings', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { classification_mode } = req.body as { classification_mode?: string };

    if (classification_mode !== 'auto_apply' && classification_mode !== 'suggest') {
      res.status(400).json({ error: 'classification_mode must be "auto_apply" or "suggest".' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('companies')
      .update({ classification_mode })
      .eq('id', companyId);

    if (error) throw error;

    res.json({ status: 'ok', classification_mode });
  } catch (err) {
    next(err);
  }
});

export default router;
