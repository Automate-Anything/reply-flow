import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/superAdmin.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

const BCRYPT_ROUNDS = 12;

// ═══════════════════════════════════════════════════════════════
// AFFILIATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── GET /affiliates — List all affiliates with aggregate stats ──
router.get('/affiliates', async (req, res, next) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    let query = supabaseAdmin
      .from('affiliates')
      .select(
        'id, name, email, phone, approval_status, affiliate_code, ' +
        'commission_schedule_id, bank_account_added, created_at'
      );

    if (statusFilter) {
      query = query.eq('approval_status', statusFilter);
    }

    const { data: affiliates, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    // Enrich with aggregate stats
    const enriched = await Promise.all(
      (affiliates || []).map(async (aff: any) => {
        const [referralResult, commissionResult, pendingResult] = await Promise.all([
          supabaseAdmin
            .from('affiliate_referrals')
            .select('*', { count: 'exact', head: true })
            .eq('affiliate_id', aff.id),
          supabaseAdmin
            .from('commission_events')
            .select('commission_amount_cents')
            .eq('affiliate_id', aff.id),
          supabaseAdmin
            .from('commission_events')
            .select('commission_amount_cents')
            .eq('affiliate_id', aff.id)
            .is('payout_id', null),
        ]);

        const totalEarnedCents = (commissionResult.data || []).reduce(
          (sum: number, r: any) => sum + (r.commission_amount_cents || 0), 0
        );
        const pendingPayoutCents = (pendingResult.data || []).reduce(
          (sum: number, r: any) => sum + (r.commission_amount_cents || 0), 0
        );

        return {
          ...aff,
          referral_count: referralResult.count || 0,
          total_earned_cents: totalEarnedCents,
          pending_payout_cents: pendingPayoutCents,
        };
      })
    );

    res.json({ affiliates: enriched });
  } catch (err) {
    next(err);
  }
});

// ── POST /affiliates — Invite/create new affiliate (admin-created) ──
router.post('/affiliates', async (req, res, next) => {
  try {
    const { name, email, phone, commission_schedule_id, approval_status } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'name and email are required' });
      return;
    }

    // Check for existing affiliate
    const { data: existing } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'An affiliate with this email already exists' });
      return;
    }

    // Generate temp password and affiliate code
    const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const affiliateCode = crypto.randomBytes(6).toString('base64url').slice(0, 8);

    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .insert({
        name,
        email: email.toLowerCase().trim(),
        phone: phone || null,
        password_hash: passwordHash,
        affiliate_code: affiliateCode,
        approval_status: approval_status || 'approved',
        commission_schedule_id: commission_schedule_id || null,
      })
      .select('id, name, email, phone, affiliate_code, approval_status, commission_schedule_id, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'An affiliate with this email already exists' });
        return;
      }
      throw error;
    }

    // Create default notification preferences
    await supabaseAdmin
      .from('affiliate_notification_preferences')
      .insert({ affiliate_id: affiliate.id });

    res.status(201).json({ affiliate, tempPassword });
  } catch (err) {
    next(err);
  }
});

// ── GET /affiliates/:id — Get single affiliate detail ──
router.get('/affiliates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select(
        'id, name, email, phone, approval_status, affiliate_code, ' +
        'stripe_connect_account_id, bank_account_added, commission_schedule_id, ' +
        'commission_type, commission_rate, created_at, updated_at'
      )
      .eq('id', id)
      .single();

    if (error || !affiliate) {
      res.status(404).json({ error: 'Affiliate not found' });
      return;
    }

    // Fetch related data in parallel
    const [
      { data: referrals },
      { data: commissionEvents },
      { data: payouts },
    ] = await Promise.all([
      supabaseAdmin
        .from('affiliate_referrals')
        .select('id, company_id, status, payment_count, last_plan_name, commission_schedule_id, schedule_override_applied, created_at')
        .eq('affiliate_id', id)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('commission_events')
        .select('id, referral_id, event_type, payment_number, plan_name, invoice_amount_cents, commission_amount_cents, stripe_invoice_id, payout_id, created_at')
        .eq('affiliate_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('affiliate_payouts')
        .select('id, period_start, period_end, amount_cents, status, stripe_transfer_id, paid_at, created_at')
        .eq('affiliate_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    res.json({
      affiliate,
      referrals: referrals || [],
      recent_commission_events: commissionEvents || [],
      payouts: payouts || [],
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /affiliates/:id — Update affiliate ──
router.put('/affiliates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      approval_status,
      commission_schedule_id,
      name,
      email,
      phone,
      commission_type,
      commission_rate,
      apply_to_existing_referrals,
    } = req.body;

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (approval_status !== undefined) updates.approval_status = approval_status;
    if (commission_schedule_id !== undefined) updates.commission_schedule_id = commission_schedule_id;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase().trim();
    if (phone !== undefined) updates.phone = phone;
    if (commission_type !== undefined) updates.commission_type = commission_type;
    if (commission_rate !== undefined) updates.commission_rate = commission_rate;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .update(updates)
      .eq('id', id)
      .select('id, name, email, phone, approval_status, affiliate_code, commission_schedule_id, commission_type, commission_rate, created_at, updated_at')
      .single();

    if (error) throw error;
    if (!affiliate) {
      res.status(404).json({ error: 'Affiliate not found' });
      return;
    }

    // Apply schedule to existing referrals if requested
    if (apply_to_existing_referrals && commission_schedule_id) {
      await supabaseAdmin
        .from('affiliate_referrals')
        .update({
          commission_schedule_id,
          schedule_override_applied: true,
        })
        .eq('affiliate_id', id)
        .in('status', ['pending', 'trialing', 'active']);
    }

    res.json({ affiliate });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /affiliates/:id — Delete affiliate ──
router.delete('/affiliates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('affiliates')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Affiliate deleted' });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── GET /schedules — List all commission schedules with periods ──
router.get('/schedules', async (_req, res, next) => {
  try {
    const { data: schedules, error } = await supabaseAdmin
      .from('commission_schedules')
      .select('id, name, commission_type, end_behavior, end_rate, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch periods for each schedule
    const enriched = await Promise.all(
      (schedules || []).map(async (schedule) => {
        const { data: periods } = await supabaseAdmin
          .from('commission_schedule_periods')
          .select('id, from_payment, to_payment, rate')
          .eq('schedule_id', schedule.id)
          .order('from_payment');

        return { ...schedule, periods: periods || [] };
      })
    );

    res.json({ schedules: enriched });
  } catch (err) {
    next(err);
  }
});

// ── POST /schedules — Create schedule + periods ──
router.post('/schedules', async (req, res, next) => {
  try {
    const { name, commission_type, end_behavior, end_rate, periods } = req.body;

    if (!name || !commission_type || !end_behavior) {
      res.status(400).json({ error: 'name, commission_type, and end_behavior are required' });
      return;
    }

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('commission_schedules')
      .insert({
        name,
        commission_type,
        end_behavior,
        end_rate: end_rate ?? null,
      })
      .select()
      .single();

    if (scheduleError) throw scheduleError;

    // Insert periods if provided
    if (Array.isArray(periods) && periods.length > 0) {
      const periodRows = periods.map((p: { from_payment: number; to_payment: number; rate: number }) => ({
        schedule_id: schedule.id,
        from_payment: p.from_payment,
        to_payment: p.to_payment,
        rate: p.rate,
      }));

      const { error: periodsError } = await supabaseAdmin
        .from('commission_schedule_periods')
        .insert(periodRows);

      if (periodsError) throw periodsError;
    }

    // Re-fetch with periods for the response
    const { data: fetchedPeriods } = await supabaseAdmin
      .from('commission_schedule_periods')
      .select('id, from_payment, to_payment, rate')
      .eq('schedule_id', schedule.id)
      .order('from_payment');

    res.status(201).json({ schedule: { ...schedule, periods: fetchedPeriods || [] } });
  } catch (err) {
    next(err);
  }
});

// ── PUT /schedules/:id — Update schedule + periods ──
router.put('/schedules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, commission_type, end_behavior, end_rate, periods } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (commission_type !== undefined) updates.commission_type = commission_type;
    if (end_behavior !== undefined) updates.end_behavior = end_behavior;
    if (end_rate !== undefined) updates.end_rate = end_rate;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from('commission_schedules')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    }

    // Replace periods if provided
    if (Array.isArray(periods)) {
      // Delete existing periods
      const { error: deleteError } = await supabaseAdmin
        .from('commission_schedule_periods')
        .delete()
        .eq('schedule_id', id);

      if (deleteError) throw deleteError;

      // Insert new periods
      if (periods.length > 0) {
        const periodRows = periods.map((p: { from_payment: number; to_payment: number; rate: number }) => ({
          schedule_id: id,
          from_payment: p.from_payment,
          to_payment: p.to_payment,
          rate: p.rate,
        }));

        const { error: insertError } = await supabaseAdmin
          .from('commission_schedule_periods')
          .insert(periodRows);

        if (insertError) throw insertError;
      }
    }

    // Re-fetch full schedule with periods
    const { data: schedule, error: fetchError } = await supabaseAdmin
      .from('commission_schedules')
      .select('id, name, commission_type, end_behavior, end_rate, created_at')
      .eq('id', id)
      .single();

    if (fetchError || !schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const { data: fetchedPeriods } = await supabaseAdmin
      .from('commission_schedule_periods')
      .select('id, from_payment, to_payment, rate')
      .eq('schedule_id', id)
      .order('from_payment');

    res.json({ schedule: { ...schedule, periods: fetchedPeriods || [] } });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /schedules/:id — Delete schedule ──
router.delete('/schedules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if any affiliates reference this schedule
    const { count } = await supabaseAdmin
      .from('affiliates')
      .select('*', { count: 'exact', head: true })
      .eq('commission_schedule_id', id);

    if (count && count > 0) {
      res.status(409).json({
        error: `Cannot delete schedule: ${count} affiliate(s) are currently using it. Reassign them first.`,
      });
      return;
    }

    const { error } = await supabaseAdmin
      .from('commission_schedules')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYOUT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── GET /payouts — List all payouts across all affiliates ──
router.get('/payouts', async (req, res, next) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    let query = supabaseAdmin
      .from('affiliate_payouts')
      .select('id, affiliate_id, period_start, period_end, amount_cents, status, stripe_transfer_id, paid_at, created_at');

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data: payouts, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    // Enrich with affiliate name/email
    const affiliateIds = [...new Set((payouts || []).map(p => p.affiliate_id))];
    const affiliateMap: Record<string, { name: string; email: string }> = {};

    if (affiliateIds.length > 0) {
      const { data: affiliates } = await supabaseAdmin
        .from('affiliates')
        .select('id, name, email')
        .in('id', affiliateIds);

      for (const aff of affiliates || []) {
        affiliateMap[aff.id] = { name: aff.name, email: aff.email };
      }
    }

    const enriched = (payouts || []).map(p => ({
      ...p,
      affiliate_name: affiliateMap[p.affiliate_id]?.name || 'Unknown',
      affiliate_email: affiliateMap[p.affiliate_id]?.email || 'Unknown',
    }));

    res.json({ payouts: enriched });
  } catch (err) {
    next(err);
  }
});

// ── POST /payouts/run — Manually trigger payout run ──
router.post('/payouts/run', async (_req, res, next) => {
  try {
    const { runPayouts } = await import('../cron/affiliatePayouts.js');
    const result = await runPayouts();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /payouts/:id/retry — Retry a failed payout ──
router.post('/payouts/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify payout exists and is failed
    const { data: payout, error: fetchError } = await supabaseAdmin
      .from('affiliate_payouts')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !payout) {
      res.status(404).json({ error: 'Payout not found' });
      return;
    }

    if (payout.status !== 'failed') {
      res.status(400).json({ error: `Cannot retry payout with status '${payout.status}'. Only failed payouts can be retried.` });
      return;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('affiliate_payouts')
      .update({ status: 'pending' })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ payout: updated });
  } catch (err) {
    next(err);
  }
});

// ── GET /payout-settings — Return payout_settings singleton row ──
router.get('/payout-settings', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('payout_settings')
      .select('id, min_payout_cents, payout_day_of_month, updated_at')
      .single();

    if (error) throw error;

    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// ── PUT /payout-settings — Update payout settings ──
router.put('/payout-settings', async (req, res, next) => {
  try {
    const { min_payout_cents, payout_day_of_month } = req.body;

    const updates: Record<string, unknown> = {};
    if (min_payout_cents !== undefined) updates.min_payout_cents = min_payout_cents;
    if (payout_day_of_month !== undefined) updates.payout_day_of_month = payout_day_of_month;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('payout_settings')
      .update(updates)
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .select()
      .single();

    if (error) throw error;

    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════
// AGREEMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ── GET /agreements — List all agreement versions with acceptance counts ──
router.get('/agreements', async (_req, res, next) => {
  try {
    const { data: agreements, error } = await supabaseAdmin
      .from('affiliate_agreements')
      .select('id, version, terms_text, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Count acceptances for each agreement
    const enriched = await Promise.all(
      (agreements || []).map(async (agreement) => {
        const { count } = await supabaseAdmin
          .from('affiliate_agreement_acceptances')
          .select('*', { count: 'exact', head: true })
          .eq('agreement_id', agreement.id);

        return { ...agreement, accepted_count: count || 0 };
      })
    );

    res.json({ agreements: enriched });
  } catch (err) {
    next(err);
  }
});

// ── POST /agreements — Create new agreement version ──
router.post('/agreements', async (req, res, next) => {
  try {
    const { version, terms_text } = req.body;

    if (!version || !terms_text) {
      res.status(400).json({ error: 'version and terms_text are required' });
      return;
    }

    const { data: agreement, error } = await supabaseAdmin
      .from('affiliate_agreements')
      .insert({ version, terms_text })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ agreement });
  } catch (err) {
    next(err);
  }
});

export default router;
