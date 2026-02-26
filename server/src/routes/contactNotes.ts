import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List notes for a contact
router.get('/:contactId', requirePermission('contact_notes', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
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
router.post('/:contactId', requirePermission('contact_notes', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
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
      .eq('company_id', companyId)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .insert({ contact_id: contactId, company_id: companyId, created_by: req.userId, content })
      .select()
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Update a note
router.put('/:contactId/:noteId', requirePermission('contact_notes', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { noteId } = req.params;
    const { content } = req.body;

    const { data, error } = await supabaseAdmin
      .from('contact_notes')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete a note
router.delete('/:contactId/:noteId', requirePermission('contact_notes', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { noteId } = req.params;

    await supabaseAdmin
      .from('contact_notes')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
