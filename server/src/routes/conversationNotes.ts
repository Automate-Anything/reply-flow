import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List notes for a conversation
router.get('/:sessionId', requirePermission('conversation_notes', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    // Verify session belongs to company
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

    const { data, error } = await supabaseAdmin
      .from('conversation_notes')
      .select('*, author:created_by(id, full_name, avatar_url)')
      .eq('session_id', sessionId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ notes: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create a note
router.post('/:sessionId', requirePermission('conversation_notes', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Verify session belongs to company
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

    const { data, error } = await supabaseAdmin
      .from('conversation_notes')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        created_by: req.userId,
        content,
      })
      .select('*, author:created_by(id, full_name, avatar_url)')
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Update a note
router.put('/:sessionId/:noteId', requirePermission('conversation_notes', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { noteId } = req.params;
    const { content } = req.body;

    const { data, error } = await supabaseAdmin
      .from('conversation_notes')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('company_id', companyId)
      .select('*, author:created_by(id, full_name, avatar_url)')
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete a note
router.delete('/:sessionId/:noteId', requirePermission('conversation_notes', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { noteId } = req.params;

    await supabaseAdmin
      .from('conversation_notes')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
