import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List all labels for the user
router.get('/', requirePermission('labels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('labels')
      .select('*')
      .eq('company_id', companyId)
      .order('name');

    if (error) throw error;
    res.json({ labels: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create a label
router.post('/', requirePermission('labels', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, color } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('labels')
      .insert({ company_id: companyId, created_by: req.userId, name, color: color || '#6B7280' })
      .select()
      .single();

    if (error) throw error;
    res.json({ label: data });
  } catch (err) {
    next(err);
  }
});

// Delete a label
router.delete('/:labelId', requirePermission('labels', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { labelId } = req.params;

    await supabaseAdmin
      .from('labels')
      .delete()
      .eq('id', labelId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Add label to conversation
router.post('/assign', requirePermission('labels', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, labelId } = req.body;

    if (!sessionId || !labelId) {
      res.status(400).json({ error: 'sessionId and labelId are required' });
      return;
    }

    // Verify ownership
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('conversation_labels')
      .upsert({ session_id: sessionId, label_id: labelId });

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Remove label from conversation
router.delete('/assign/:sessionId/:labelId', requirePermission('labels', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, labelId } = req.params;

    // Verify ownership
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await supabaseAdmin
      .from('conversation_labels')
      .delete()
      .eq('session_id', sessionId)
      .eq('label_id', labelId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
