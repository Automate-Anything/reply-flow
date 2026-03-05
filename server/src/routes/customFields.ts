import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List active definitions for company
router.get('/definitions', requirePermission('custom_fields', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('custom_field_definitions')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('display_order')
      .order('created_at');

    if (error) throw error;
    res.json({ definitions: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create definition
router.post('/definitions', requirePermission('custom_fields', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, field_type, options, is_required, display_order } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!field_type) {
      res.status(400).json({ error: 'Field type is required' });
      return;
    }

    // Get next display_order if not provided
    let order = display_order;
    if (order === undefined) {
      const { data: maxRow } = await supabaseAdmin
        .from('custom_field_definitions')
        .select('display_order')
        .eq('company_id', companyId)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();
      order = (maxRow?.display_order ?? -1) + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('custom_field_definitions')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        name: name.trim(),
        field_type,
        options: options || [],
        is_required: is_required || false,
        display_order: order,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A field with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ definition: data });
  } catch (err) {
    next(err);
  }
});

// Bulk reorder definitions (must be before :defId route)
router.put('/definitions/reorder', requirePermission('custom_fields', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { order } = req.body;

    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order array is required' });
      return;
    }

    for (const item of order as { id: string; display_order: number }[]) {
      await supabaseAdmin
        .from('custom_field_definitions')
        .update({ display_order: item.display_order })
        .eq('id', item.id)
        .eq('company_id', companyId);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Update definition
router.put('/definitions/:defId', requirePermission('custom_fields', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { defId } = req.params;
    const { name, field_type, options, is_required, is_active, display_order } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (field_type !== undefined) updates.field_type = field_type;
    if (options !== undefined) updates.options = options;
    if (is_required !== undefined) updates.is_required = is_required;
    if (is_active !== undefined) updates.is_active = is_active;
    if (display_order !== undefined) updates.display_order = display_order;

    const { data, error } = await supabaseAdmin
      .from('custom_field_definitions')
      .update(updates)
      .eq('id', defId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A field with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ definition: data });
  } catch (err) {
    next(err);
  }
});

// Soft deactivate definition (preserves data)
router.delete('/definitions/:defId', requirePermission('custom_fields', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { defId } = req.params;

    const { error } = await supabaseAdmin
      .from('custom_field_definitions')
      .update({ is_active: false })
      .eq('id', defId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
