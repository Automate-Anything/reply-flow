import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List canned responses
router.get('/', requirePermission('canned_responses', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { category } = req.query;

    let query = supabaseAdmin
      .from('canned_responses')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .or(`visibility.eq.company,created_by.eq.${req.userId}`)
      .order('title', { ascending: true });

    if (category) {
      query = query.eq('category', String(category));
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ responses: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create canned response
router.post('/', requirePermission('canned_responses', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { title, content, shortcut, category, visibility = 'company' } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    if (!['personal', 'company'].includes(visibility)) {
      res.status(400).json({ error: 'visibility must be "personal" or "company"' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('canned_responses')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        title,
        content,
        shortcut: shortcut || null,
        category: category || null,
        visibility,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ response: data });
  } catch (err) {
    next(err);
  }
});

// Update canned response
router.put('/:id', requirePermission('canned_responses', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { title, content, shortcut, category } = req.body;

    // Check ownership for personal items
    const { data: existing } = await supabaseAdmin
      .from('canned_responses')
      .select('visibility, created_by')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Canned response not found' });
      return;
    }

    if (existing.visibility === 'personal' && existing.created_by !== req.userId) {
      res.status(403).json({ error: 'You can only edit your own personal quick replies' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (shortcut !== undefined) updates.shortcut = shortcut || null;
    if (category !== undefined) updates.category = category || null;

    const { data, error } = await supabaseAdmin
      .from('canned_responses')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ response: data });
  } catch (err) {
    next(err);
  }
});

// Share a personal canned response to company
router.patch('/:id/share', requirePermission('canned_responses', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    // Verify item exists and belongs to current user
    const { data: item } = await supabaseAdmin
      .from('canned_responses')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .eq('created_by', req.userId)
      .eq('visibility', 'personal')
      .eq('is_deleted', false)
      .single();

    if (!item) {
      res.status(404).json({ error: 'Personal quick reply not found' });
      return;
    }

    // Check for title conflict with existing company items
    const { data: existing } = await supabaseAdmin
      .from('canned_responses')
      .select('id')
      .eq('company_id', companyId)
      .eq('title', item.title)
      .eq('visibility', 'company')
      .eq('is_deleted', false)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'A company quick reply with this title already exists' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('canned_responses')
      .update({ visibility: 'company', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ response: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete canned response
router.delete('/:id', requirePermission('canned_responses', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    await supabaseAdmin
      .from('canned_responses')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
