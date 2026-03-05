import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List all statuses for company
router.get('/', requirePermission('conversation_statuses', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('conversation_statuses')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('group')
      .order('sort_order');

    if (error) throw error;
    res.json({ statuses: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create a status
router.post('/', requirePermission('conversation_statuses', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, color, group } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!['open', 'closed'].includes(group)) {
      res.status(400).json({ error: 'Group must be "open" or "closed"' });
      return;
    }

    // Get max sort_order for this group
    const { data: existing } = await supabaseAdmin
      .from('conversation_statuses')
      .select('sort_order')
      .eq('company_id', companyId)
      .eq('group', group)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('conversation_statuses')
      .insert({
        company_id: companyId,
        name: name.trim(),
        color: color || '#6B7280',
        group,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'A status with that name already exists' });
        return;
      }
      throw error;
    }
    res.json({ status: data });
  } catch (err) {
    next(err);
  }
});

// Reorder statuses — must be before /:statusId
router.put('/reorder', requirePermission('conversation_statuses', 'edit'), async (_req, res, next) => {
  try {
    const companyId = _req.companyId!;
    const { statuses } = _req.body;

    if (!Array.isArray(statuses)) {
      res.status(400).json({ error: 'statuses array is required' });
      return;
    }

    for (const s of statuses) {
      await supabaseAdmin
        .from('conversation_statuses')
        .update({ sort_order: s.sort_order, updated_at: new Date().toISOString() })
        .eq('id', s.id)
        .eq('company_id', companyId);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Update a status
router.put('/:statusId', requirePermission('conversation_statuses', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { statusId } = req.params;
    const { name, color, group, sort_order } = req.body;

    // Fetch current status
    const { data: current } = await supabaseAdmin
      .from('conversation_statuses')
      .select('*')
      .eq('id', statusId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .single();

    if (!current) {
      res.status(404).json({ error: 'Status not found' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const oldName = current.name;
    if (name !== undefined) updates.name = name.trim();
    if (color !== undefined) updates.color = color;
    if (group !== undefined) {
      if (!['open', 'closed'].includes(group)) {
        res.status(400).json({ error: 'Group must be "open" or "closed"' });
        return;
      }
      updates.group = group;
    }
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabaseAdmin
      .from('conversation_statuses')
      .update(updates)
      .eq('id', statusId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'A status with that name already exists' });
        return;
      }
      throw error;
    }

    // If name changed, update all conversations with the old status name
    if (name !== undefined && name.trim() !== oldName) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ status: name.trim() })
        .eq('company_id', companyId)
        .eq('status', oldName);
    }

    // If group changed, update ended_at on affected conversations
    if (group !== undefined && group !== current.group) {
      const statusName = (name?.trim()) || current.name;
      if (group === 'closed') {
        await supabaseAdmin
          .from('chat_sessions')
          .update({ ended_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('status', statusName)
          .is('ended_at', null);
      } else {
        await supabaseAdmin
          .from('chat_sessions')
          .update({ ended_at: null })
          .eq('company_id', companyId)
          .eq('status', statusName)
          .not('ended_at', 'is', null);
      }
    }

    res.json({ status: data });
  } catch (err) {
    next(err);
  }
});

// Delete a status (soft delete)
router.delete('/:statusId', requirePermission('conversation_statuses', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { statusId } = req.params;

    // Check if it's the default status
    const { data: status } = await supabaseAdmin
      .from('conversation_statuses')
      .select('is_default')
      .eq('id', statusId)
      .eq('company_id', companyId)
      .single();

    if (!status) {
      res.status(404).json({ error: 'Status not found' });
      return;
    }

    if (status.is_default) {
      res.status(400).json({ error: 'Cannot delete the default status' });
      return;
    }

    await supabaseAdmin
      .from('conversation_statuses')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', statusId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
