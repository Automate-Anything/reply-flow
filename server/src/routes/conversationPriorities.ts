import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

const DEFAULT_PRIORITIES = [
  { name: 'Urgent', color: '#EF4444', sort_order: 0 },
  { name: 'High', color: '#F97316', sort_order: 1 },
  { name: 'Medium', color: '#EAB308', sort_order: 2 },
  { name: 'Low', color: '#3B82F6', sort_order: 3 },
  { name: 'None', color: '#9CA3AF', sort_order: 4, is_default: true },
];

async function ensureDefaultPriorities(companyId: string) {
  const { data: existing, error } = await supabaseAdmin
    .from('conversation_priorities')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .limit(1);

  if (error) throw error;
  if ((existing || []).length > 0) return;

  const { error: insertError } = await supabaseAdmin
    .from('conversation_priorities')
    .insert(
      DEFAULT_PRIORITIES.map((priority) => ({
        company_id: companyId,
        ...priority,
      }))
    );

  if (insertError && insertError.code !== '23505') throw insertError;
}

router.get('/', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    await ensureDefaultPriorities(companyId);

    const { data, error } = await supabaseAdmin
      .from('conversation_priorities')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('sort_order');

    if (error) throw error;
    res.json({ priorities: data || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, color } = req.body as { name?: string; color?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('conversation_priorities')
      .select('sort_order')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('conversation_priorities')
      .insert({
        company_id: companyId,
        name: name.trim(),
        color: color || '#6B7280',
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'A priority with that name already exists' });
        return;
      }
      throw error;
    }

    res.json({ priority: data });
  } catch (err) {
    next(err);
  }
});

router.put('/reorder', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { priorities } = req.body as { priorities?: Array<{ id: string; sort_order: number }> };

    if (!Array.isArray(priorities)) {
      res.status(400).json({ error: 'priorities array is required' });
      return;
    }

    for (const priority of priorities) {
      await supabaseAdmin
        .from('conversation_priorities')
        .update({ sort_order: priority.sort_order, updated_at: new Date().toISOString() })
        .eq('id', priority.id)
        .eq('company_id', companyId);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

router.put('/:priorityId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { priorityId } = req.params;
    const { name, color } = req.body as { name?: string; color?: string };

    const { data: current } = await supabaseAdmin
      .from('conversation_priorities')
      .select('*')
      .eq('id', priorityId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .single();

    if (!current) {
      res.status(404).json({ error: 'Priority not found' });
      return;
    }

    const oldName = current.name;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (color !== undefined) updates.color = color;

    const { data, error } = await supabaseAdmin
      .from('conversation_priorities')
      .update(updates)
      .eq('id', priorityId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'A priority with that name already exists' });
        return;
      }
      throw error;
    }

    if (name !== undefined && name.trim() !== oldName) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ priority: name.trim() })
        .eq('company_id', companyId)
        .eq('priority', oldName);
    }

    res.json({ priority: data });
  } catch (err) {
    next(err);
  }
});

router.delete('/:priorityId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { priorityId } = req.params;

    const { data: priority } = await supabaseAdmin
      .from('conversation_priorities')
      .select('name, is_default')
      .eq('id', priorityId)
      .eq('company_id', companyId)
      .single();

    if (!priority) {
      res.status(404).json({ error: 'Priority not found' });
      return;
    }

    if (priority.is_default) {
      res.status(400).json({ error: 'Cannot delete the default priority' });
      return;
    }

    await supabaseAdmin
      .from('conversation_priorities')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', priorityId)
      .eq('company_id', companyId);

    await supabaseAdmin
      .from('chat_sessions')
      .update({ priority: 'None' })
      .eq('company_id', companyId)
      .eq('priority', priority.name);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
