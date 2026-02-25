import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// Get AI settings
router.get('/settings', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data, error } = await supabaseAdmin
      .from('ai_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No settings row yet — return defaults
      res.json({
        settings: {
          is_enabled: false,
          system_prompt: 'You are a helpful business assistant. Respond professionally and concisely.',
          max_tokens: 500,
        },
      });
      return;
    }

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// Update AI settings (upsert)
router.put('/settings', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { is_enabled, system_prompt, max_tokens } = req.body;

    const updates: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;
    if (system_prompt !== undefined) updates.system_prompt = system_prompt;
    if (max_tokens !== undefined) updates.max_tokens = max_tokens;

    const { data, error } = await supabaseAdmin
      .from('ai_settings')
      .upsert(updates, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// Pause AI for a conversation (human takeover)
router.post('/pause/:sessionId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { sessionId } = req.params;
    const { duration_minutes } = req.body; // optional: auto-resume after N minutes

    const updates: Record<string, unknown> = {
      human_takeover: true,
      updated_at: new Date().toISOString(),
    };

    if (duration_minutes) {
      const resumeAt = new Date(Date.now() + duration_minutes * 60_000);
      updates.auto_resume_at = resumeAt.toISOString();
    } else {
      updates.auto_resume_at = null;
    }

    await supabaseAdmin
      .from('chat_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('user_id', userId);

    res.json({ status: 'paused' });
  } catch (err) {
    next(err);
  }
});

// Resume AI for a conversation
router.post('/resume/:sessionId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { sessionId } = req.params;

    await supabaseAdmin
      .from('chat_sessions')
      .update({
        human_takeover: false,
        auto_resume_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('user_id', userId);

    res.json({ status: 'resumed' });
  } catch (err) {
    next(err);
  }
});

export default router;
