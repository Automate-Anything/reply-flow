import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────
// GET COMPANY INFO
// ────────────────────────────────────────────────
router.get('/', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    res.json({ company: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// UPDATE COMPANY INFO
// ────────────────────────────────────────────────
router.put('/', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, slug, logo_url } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (logo_url !== undefined) updates.logo_url = logo_url;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(updates)
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ company: data });
  } catch (err) {
    next(err);
  }
});

export default router;
