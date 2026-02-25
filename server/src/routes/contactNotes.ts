import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List notes for a contact
router.get('/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ notes: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create a note
router.post('/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Verify contact ownership
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .insert({ contact_id: contactId, user_id: userId, content })
      .select()
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Update a note
router.put('/:contactId/:noteId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { noteId } = req.params;
    const { content } = req.body;

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete a note
router.delete('/:contactId/:noteId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { noteId } = req.params;

    await supabaseAdmin
      .from('contact_notes')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('user_id', userId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
