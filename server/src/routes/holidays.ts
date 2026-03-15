import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// GET /api/holidays?scope=company|user (optional filter)
// Returns company holidays + current user's personal holidays by default
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { scope } = req.query;

    let query = supabaseAdmin
      .from('holidays')
      .select('*')
      .eq('company_id', companyId)
      .order('date', { ascending: true });

    if (scope === 'company') {
      query = query.eq('scope', 'company');
    } else if (scope === 'user') {
      query = query.eq('scope', 'user').eq('user_id', userId);
    } else {
      // Default: company holidays + this user's personal holidays
      query = query.or(`scope.eq.company,and(scope.eq.user,user_id.eq.${userId})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ holidays: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/holidays
// Company-scope requires company_settings.edit permission
router.post('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { name, date, recurring, scope } = req.body;

    if (!name?.trim() || !date) {
      res.status(400).json({ error: 'Name and date are required' });
      return;
    }

    const resolvedScope: 'company' | 'user' = scope === 'company' ? 'company' : 'user';

    // Company holidays require company_settings.edit permission
    if (resolvedScope === 'company') {
      return requirePermission('company_settings', 'edit')(req, res, async () => {
        try {
          const { data, error } = await supabaseAdmin
            .from('holidays')
            .insert({
              company_id: companyId,
              user_id: null,
              scope: 'company',
              name: name.trim(),
              date,
              recurring: !!recurring,
            })
            .select()
            .single();

          if (error) throw error;
          res.status(201).json({ holiday: data });
        } catch (err) {
          next(err);
        }
      });
    }

    // User-scope holiday
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .insert({
        company_id: companyId,
        user_id: userId,
        scope: 'user',
        name: name.trim(),
        date,
        recurring: !!recurring,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ holiday: data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/holidays/:id
router.put('/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { name, date, recurring } = req.body;

    // Verify the holiday exists and belongs to this company
    const { data: existing } = await supabaseAdmin
      .from('holidays')
      .select('scope, user_id')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Holiday not found' });
      return;
    }

    // User-scope: only the owner can edit
    if (existing.scope === 'user' && existing.user_id !== userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (date !== undefined) updates.date = date;
    if (recurring !== undefined) updates.recurring = !!recurring;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Company-scope edits require company_settings.edit permission
    if (existing.scope === 'company') {
      return requirePermission('company_settings', 'edit')(req, res, async () => {
        try {
          const { data, error } = await supabaseAdmin
            .from('holidays')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

          if (error) throw error;
          res.json({ holiday: data });
        } catch (err) {
          next(err);
        }
      });
    }

    // User-scope update
    const { data, error } = await supabaseAdmin
      .from('holidays')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ holiday: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;

    const { data: existing } = await supabaseAdmin
      .from('holidays')
      .select('scope, user_id')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Holiday not found' });
      return;
    }

    // User-scope: only the owner can delete
    if (existing.scope === 'user' && existing.user_id !== userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    // Company-scope deletes require company_settings.edit permission
    if (existing.scope === 'company') {
      return requirePermission('company_settings', 'edit')(req, res, async () => {
        try {
          const { error } = await supabaseAdmin
            .from('holidays')
            .delete()
            .eq('id', req.params.id);

          if (error) throw error;
          res.json({ success: true });
        } catch (err) {
          next(err);
        }
      });
    }

    // User-scope delete
    const { error } = await supabaseAdmin
      .from('holidays')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
