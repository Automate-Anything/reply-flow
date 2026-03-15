import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

function getStartOfNextDayUTC(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);

  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  const localHour = parseInt(parts.find(p => p.type === 'hour')!.value);

  // Compute approximate UTC offset
  const utcHour = now.getUTCHours();
  const offsetHours = localHour - utcHour;

  // Tomorrow midnight in local TZ, converted to UTC
  const tomorrowMidnightUTC = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  tomorrowMidnightUTC.setUTCHours(tomorrowMidnightUTC.getUTCHours() - offsetHours);
  return tomorrowMidnightUTC.toISOString();
}

const router = Router();
router.use(requireAuth);

// List rules for company (with members)
router.get('/rules', requirePermission('channels', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { data, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .select('*, members:auto_assign_members(*, user:user_id(id, full_name, avatar_url))')
      .eq('company_id', companyId)
      .order('created_at');

    if (error) throw error;
    res.json({ rules: data || [] });
  } catch (err) {
    next(err);
  }
});

// Create rule
router.post('/rules', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { channel_id, strategy, config, member_ids } = req.body;

    if (!strategy || !['round_robin', 'least_busy', 'tag_based'].includes(strategy)) {
      res.status(400).json({ error: 'Invalid strategy' });
      return;
    }

    const { data: rule, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .insert({
        company_id: companyId,
        channel_id: channel_id || null,
        strategy,
        config: config || {},
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A rule already exists for this channel' });
        return;
      }
      throw error;
    }

    // Add members if provided
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      await supabaseAdmin
        .from('auto_assign_members')
        .insert(member_ids.map((uid: string) => ({ rule_id: rule.id, user_id: uid })));
    }

    res.json({ rule });
  } catch (err) {
    next(err);
  }
});

// Update rule
router.put('/rules/:ruleId', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { ruleId } = req.params;
    const { strategy, config, is_active, member_ids } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (strategy) updates.strategy = strategy;
    if (config !== undefined) updates.config = config;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from('auto_assign_rules')
      .update(updates)
      .eq('id', ruleId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    // Sync members if provided
    if (Array.isArray(member_ids)) {
      // Remove all existing members
      await supabaseAdmin
        .from('auto_assign_members')
        .delete()
        .eq('rule_id', ruleId);

      // Add new members
      if (member_ids.length > 0) {
        await supabaseAdmin
          .from('auto_assign_members')
          .insert(member_ids.map((uid: string) => ({ rule_id: ruleId, user_id: uid })));
      }
    }

    res.json({ rule: data });
  } catch (err) {
    next(err);
  }
});

// Delete rule
router.delete('/rules/:ruleId', requirePermission('channels', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { ruleId } = req.params;

    await supabaseAdmin
      .from('auto_assign_rules')
      .delete()
      .eq('id', ruleId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Toggle member availability
router.patch('/members/:memberId/availability', async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { is_available } = req.body;

    // Members can toggle their own availability
    const { data, error } = await supabaseAdmin
      .from('auto_assign_members')
      .update({ is_available })
      .eq('id', memberId)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Member not found or not authorized' });
      return;
    }

    res.json({ member: data });
  } catch (err) {
    next(err);
  }
});

// Get current user's availability status across all rules
router.get('/my-availability', async (req, res, next) => {
  try {
    const { data } = await supabaseAdmin
      .from('auto_assign_members')
      .select('id, rule_id, is_available')
      .eq('user_id', req.userId);

    const isAvailable = (data || []).length === 0 || (data || []).every((m) => m.is_available);
    res.json({ is_available: isAvailable, memberships: data || [] });
  } catch (err) {
    next(err);
  }
});

// Toggle current user's availability across all rules
router.patch('/my-availability', async (req, res, next) => {
  try {
    const { is_available } = req.body;

    await supabaseAdmin
      .from('auto_assign_members')
      .update({ is_available })
      .eq('user_id', req.userId);

    // Fetch user's timezone and company_id
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('timezone, company_id')
      .eq('id', req.userId)
      .single();

    let effectiveTz = 'UTC';
    if (userData) {
      if (userData.timezone) {
        effectiveTz = userData.timezone;
      } else if (userData.company_id) {
        const { data: companyData } = await supabaseAdmin
          .from('companies')
          .select('timezone')
          .eq('id', userData.company_id)
          .single();
        if (companyData?.timezone) {
          effectiveTz = companyData.timezone;
        }
      }
    }

    const overrideUntil = getStartOfNextDayUTC(effectiveTz);

    await supabaseAdmin
      .from('users')
      .update({ availability_override_until: overrideUntil })
      .eq('id', req.userId);

    res.json({ is_available });
  } catch (err) {
    next(err);
  }
});

export default router;
