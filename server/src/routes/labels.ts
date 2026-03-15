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
      .or(`visibility.eq.company,created_by.eq.${req.userId}`)
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
    const { name, color, visibility = 'company' } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!['personal', 'company'].includes(visibility)) {
      res.status(400).json({ error: 'visibility must be "personal" or "company"' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('labels')
      .insert({ user_id: req.userId, company_id: companyId, created_by: req.userId, name, color: color || '#6B7280', visibility })
      .select()
      .single();

    if (error) throw error;
    res.json({ label: data });
  } catch (err) {
    next(err);
  }
});

// Update a label
router.put('/:labelId', requirePermission('labels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { labelId } = req.params;
    const { name, color } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    // Check ownership for personal labels
    const { data: existing } = await supabaseAdmin
      .from('labels')
      .select('visibility, created_by')
      .eq('id', labelId)
      .eq('company_id', companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }

    if (existing.visibility === 'personal' && existing.created_by !== req.userId) {
      res.status(403).json({ error: 'You can only edit your own personal labels' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('labels')
      .update({ name, color })
      .eq('id', labelId)
      .eq('company_id', companyId)
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

// Share a personal label to company
router.patch('/:labelId/share', requirePermission('labels', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { labelId } = req.params;

    // Verify label exists and belongs to current user
    const { data: label } = await supabaseAdmin
      .from('labels')
      .select('*')
      .eq('id', labelId)
      .eq('company_id', companyId)
      .eq('created_by', req.userId)
      .eq('visibility', 'personal')
      .single();

    if (!label) {
      res.status(404).json({ error: 'Personal label not found' });
      return;
    }

    // Check for name conflict with existing company labels
    const { data: existing } = await supabaseAdmin
      .from('labels')
      .select('id')
      .eq('company_id', companyId)
      .eq('name', label.name)
      .eq('visibility', 'company')
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'A company label with this name already exists' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('labels')
      .update({ visibility: 'company', updated_at: new Date().toISOString() })
      .eq('id', labelId)
      .select()
      .single();

    if (error) throw error;
    res.json({ label: data });
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
