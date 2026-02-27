import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────
// CREATE COMPANY (for users with no company)
// ────────────────────────────────────────────────
router.post('/create', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Check if user already has a company
    const { data: existing } = await supabaseAdmin
      .from('company_members')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      res.status(409).json({ error: 'You already belong to a company' });
      return;
    }

    // Get user info for company name
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const name = user?.full_name
      ? `${user.full_name}'s Company`
      : `${user?.email}'s Company`;

    // Get owner role
    const { data: ownerRole } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', 'owner')
      .single();

    if (!ownerRole) {
      res.status(500).json({ error: 'Owner role not found' });
      return;
    }

    // Create company
    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({ name })
      .select()
      .single();

    if (companyError) throw companyError;

    // Create membership
    const { error: memberError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: company.id,
        user_id: userId,
        role_id: ownerRole.id,
      });

    if (memberError) throw memberError;

    // Update user's company_id
    const { error: userError } = await supabaseAdmin
      .from('users')
      .update({ company_id: company.id })
      .eq('id', userId);

    if (userError) throw userError;

    // Seed default permissions
    const { error: seedError } = await supabaseAdmin.rpc('seed_default_permissions', {
      p_company_id: company.id,
    });

    if (seedError) throw seedError;

    res.json({ company });
  } catch (err) {
    next(err);
  }
});

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
