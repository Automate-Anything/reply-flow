import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List all tags for company
router.get('/', requirePermission('contact_tags', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('contact_tags')
      .select('id, name, color, created_at')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('name');

    if (error) throw error;
    res.json({ tags: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create tag
router.post('/', requirePermission('contact_tags', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, color } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contact_tags')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        name: name.trim(),
        color: color || '#6B7280',
      })
      .select('id, name, color, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A tag with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ tag: data });
  } catch (err) {
    next(err);
  }
});

// Update tag
router.put('/:tagId', requirePermission('contact_tags', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { tagId } = req.params;
    const { name, color } = req.body;

    // Get current tag name for rename detection
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('contact_tags')
      .select('name')
      .eq('id', tagId)
      .eq('company_id', companyId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (color !== undefined) updates.color = color;

    const { data, error } = await supabaseAdmin
      .from('contact_tags')
      .update(updates)
      .eq('id', tagId)
      .eq('company_id', companyId)
      .select('id, name, color, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A tag with this name already exists' });
        return;
      }
      throw error;
    }

    // If name changed, bulk-update contacts.tags arrays
    if (name && existing.name !== name.trim()) {
      await supabaseAdmin.rpc('rename_contact_tag', {
        p_company_id: companyId,
        p_old_name: existing.name,
        p_new_name: name.trim(),
      });
    }

    res.json({ tag: data });
  } catch (err) {
    next(err);
  }
});

// Delete tag (soft delete)
router.delete('/:tagId', requirePermission('contact_tags', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { tagId } = req.params;

    const { error } = await supabaseAdmin
      .from('contact_tags')
      .update({ is_deleted: true })
      .eq('id', tagId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
