import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List all contact lists for company
router.get('/', requirePermission('contact_lists', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('name');

    if (error) throw error;

    // Get member counts for each list
    const lists = data || [];
    if (lists.length > 0) {
      const { data: counts } = await supabaseAdmin
        .from('contact_list_members')
        .select('list_id')
        .in('list_id', lists.map((l) => l.id));

      const countMap = new Map<string, number>();
      for (const row of counts || []) {
        countMap.set(row.list_id, (countMap.get(row.list_id) || 0) + 1);
      }

      for (const list of lists) {
        (list as Record<string, unknown>).member_count = countMap.get(list.id) || 0;
      }
    }

    res.json({ lists });
  } catch (err) {
    next(err);
  }
});

// Create contact list
router.post('/', requirePermission('contact_lists', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, description, color } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        name: name.trim(),
        description: description || null,
        color: color || '#6B7280',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A list with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ list: { ...data, member_count: 0 } });
  } catch (err) {
    next(err);
  }
});

// Update contact list
router.put('/:listId', requirePermission('contact_lists', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { listId } = req.params;
    const { name, description, color } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description || null;
    if (color !== undefined) updates.color = color;

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .update(updates)
      .eq('id', listId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A list with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ list: data });
  } catch (err) {
    next(err);
  }
});

// Soft-delete contact list
router.delete('/:listId', requirePermission('contact_lists', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { listId } = req.params;

    await supabaseAdmin
      .from('contact_lists')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', listId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Add contacts to a list
router.post('/:listId/members', requirePermission('contact_lists', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { listId } = req.params;
    const { contactIds } = req.body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: 'contactIds array is required' });
      return;
    }

    // Verify list belongs to company
    const { data: list } = await supabaseAdmin
      .from('contact_lists')
      .select('id')
      .eq('id', listId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .single();

    if (!list) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    // Verify contacts belong to company
    const { data: validContacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .in('id', contactIds)
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    const validIds = (validContacts || []).map((c) => c.id);
    if (validIds.length === 0) {
      res.status(404).json({ error: 'No valid contacts found' });
      return;
    }

    const rows = validIds.map((cid) => ({
      list_id: listId,
      contact_id: cid,
      added_by: req.userId,
    }));

    await supabaseAdmin
      .from('contact_list_members')
      .upsert(rows, { onConflict: 'list_id,contact_id' });

    res.json({ added: validIds.length });
  } catch (err) {
    next(err);
  }
});

// Remove contacts from a list
router.delete('/:listId/members', requirePermission('contact_lists', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { listId } = req.params;
    const { contactIds } = req.body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: 'contactIds array is required' });
      return;
    }

    // Verify list belongs to company
    const { data: list } = await supabaseAdmin
      .from('contact_lists')
      .select('id')
      .eq('id', listId)
      .eq('company_id', companyId)
      .single();

    if (!list) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    await supabaseAdmin
      .from('contact_list_members')
      .delete()
      .eq('list_id', listId)
      .in('contact_id', contactIds);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
