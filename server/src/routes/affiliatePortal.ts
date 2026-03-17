import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { requireAffiliateAuth } from '../middleware/affiliateAuth.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

const router = Router();
router.use(requireAffiliateAuth);

const BCRYPT_ROUNDS = 12;

// ── GET /me ─────────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  try {
    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select(
        'id, name, email, phone, affiliate_code, approval_status, ' +
        'stripe_connect_account_id, bank_account_added, commission_schedule_id, ' +
        'commission_type, commission_rate, deletion_requested_at, deletion_reason, ' +
        'created_at, updated_at'
      )
      .eq('id', req.affiliateId!)
      .single();

    if (error) {
      console.error('GET /me DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json(affiliate);
  } catch (err) {
    console.error('GET /me error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /profile ────────────────────────────────────────────────
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const { name, email, phone } = req.body;
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase().trim();
    if (phone !== undefined) updates.phone = phone || null;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('affiliates')
      .update(updates)
      .eq('id', req.affiliateId!);

    if (error) {
      console.error('PUT /profile DB error:', error.message);
      if (error.code === '23505') {
        res.status(409).json({ error: 'An account with this email already exists' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    console.error('PUT /profile error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /password ───────────────────────────────────────────────
router.put('/password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('password_hash')
      .eq('id', req.affiliateId!)
      .single();

    if (!affiliate) {
      res.status(404).json({ error: 'Affiliate not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, affiliate.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await supabaseAdmin
      .from('affiliates')
      .update({ password_hash: hash })
      .eq('id', req.affiliateId!);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('PUT /password error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /delete-request ────────────────────────────────────────
router.post('/delete-request', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    const { error } = await supabaseAdmin
      .from('affiliates')
      .update({
        deletion_requested_at: new Date().toISOString(),
        deletion_reason: reason || null,
      })
      .eq('id', req.affiliateId!);

    if (error) {
      console.error('POST /delete-request DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json({ message: 'Deletion request submitted' });
  } catch (err) {
    console.error('POST /delete-request error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /stats ──────────────────────────────────────────────────
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;

    // Total referrals
    const { count: totalReferrals } = await supabaseAdmin
      .from('affiliate_referrals')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', affiliateId);

    // Active companies
    const { count: activeCompanies } = await supabaseAdmin
      .from('affiliate_referrals')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', affiliateId)
      .eq('status', 'active');

    // Total commission
    const { data: totalCommData } = await supabaseAdmin
      .from('commission_events')
      .select('commission_amount_cents')
      .eq('affiliate_id', affiliateId);

    const totalCommission = (totalCommData || []).reduce(
      (sum, row) => sum + (row.commission_amount_cents || 0),
      0
    );

    // This month commission
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: monthCommData } = await supabaseAdmin
      .from('commission_events')
      .select('commission_amount_cents')
      .eq('affiliate_id', affiliateId)
      .gte('created_at', startOfMonth.toISOString());

    const thisMonthCommission = (monthCommData || []).reduce(
      (sum, row) => sum + (row.commission_amount_cents || 0),
      0
    );

    const total = totalReferrals || 0;
    const active = activeCompanies || 0;
    const conversionRate = total > 0 ? Math.round((active / total) * 10000) / 100 : 0;

    res.json({
      totalReferrals: total,
      activeCompanies: active,
      totalCommission,
      thisMonthCommission,
      conversionRate,
    });
  } catch (err) {
    console.error('GET /stats error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /balance ────────────────────────────────────────────────
router.get('/balance', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;

    // Total earned
    const { data: earnedData } = await supabaseAdmin
      .from('commission_events')
      .select('commission_amount_cents')
      .eq('affiliate_id', affiliateId);

    const totalEarnedCents = (earnedData || []).reduce(
      (sum, row) => sum + (row.commission_amount_cents || 0),
      0
    );

    // Total paid out
    const { data: paidData } = await supabaseAdmin
      .from('affiliate_payouts')
      .select('amount_cents')
      .eq('affiliate_id', affiliateId)
      .eq('status', 'paid');

    const totalPaidOutCents = (paidData || []).reduce(
      (sum, row) => sum + (row.amount_cents || 0),
      0
    );

    // Pending payout
    const { data: pendingData } = await supabaseAdmin
      .from('affiliate_payouts')
      .select('amount_cents')
      .eq('affiliate_id', affiliateId)
      .in('status', ['pending', 'processing']);

    const pendingPayoutCents = (pendingData || []).reduce(
      (sum, row) => sum + (row.amount_cents || 0),
      0
    );

    res.json({
      totalEarnedCents,
      totalPaidOutCents,
      pendingPayoutCents,
      balanceOwedCents: totalEarnedCents - totalPaidOutCents - pendingPayoutCents,
    });
  } catch (err) {
    console.error('GET /balance error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /earnings-history ───────────────────────────────────────
router.get('/earnings-history', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const { data: events } = await supabaseAdmin
      .from('commission_events')
      .select('commission_amount_cents, created_at')
      .eq('affiliate_id', affiliateId)
      .gte('created_at', twelveMonthsAgo.toISOString())
      .order('created_at', { ascending: true });

    // Group by month in application code
    const monthMap = new Map<string, number>();
    for (const event of events || []) {
      const d = new Date(event.created_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) || 0) + (event.commission_amount_cents || 0));
    }

    const history = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amountCents]) => ({ month, amountCents }));

    res.json(history);
  } catch (err) {
    console.error('GET /earnings-history error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /funnel ─────────────────────────────────────────────────
router.get('/funnel', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;

    // Campaign aggregate stats
    const { data: campaigns } = await supabaseAdmin
      .from('affiliate_campaigns')
      .select('total_clicks, total_signups')
      .eq('affiliate_id', affiliateId);

    const totalClicks = (campaigns || []).reduce((sum, c) => sum + (c.total_clicks || 0), 0);
    const totalSignups = (campaigns || []).reduce((sum, c) => sum + (c.total_signups || 0), 0);

    // Referrals by status
    const { data: referrals } = await supabaseAdmin
      .from('affiliate_referrals')
      .select('status')
      .eq('affiliate_id', affiliateId);

    const statusCounts: Record<string, number> = { pending: 0, trialing: 0, active: 0, churned: 0 };
    for (const r of referrals || []) {
      if (r.status in statusCounts) statusCounts[r.status]++;
    }

    res.json({ totalClicks, totalSignups, referralsByStatus: statusCounts });
  } catch (err) {
    console.error('GET /funnel error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /referrals ──────────────────────────────────────────────
router.get('/referrals', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;

    // Get referrals with company name
    const { data: referrals, error } = await supabaseAdmin
      .from('affiliate_referrals')
      .select(`
        id, status, last_plan_name, created_at,
        companies ( name )
      `)
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /referrals DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    // Get commission totals per referral
    const referralIds = (referrals || []).map((r) => r.id);
    let commissionByReferral: Record<string, number> = {};

    if (referralIds.length > 0) {
      const { data: commissions } = await supabaseAdmin
        .from('commission_events')
        .select('referral_id, commission_amount_cents')
        .in('referral_id', referralIds);

      for (const c of commissions || []) {
        commissionByReferral[c.referral_id] =
          (commissionByReferral[c.referral_id] || 0) + (c.commission_amount_cents || 0);
      }
    }

    const result = (referrals || []).map((r) => ({
      id: r.id,
      company_name: (r.companies as any)?.name || null,
      status: r.status,
      plan_name: r.last_plan_name,
      commission_earned: commissionByReferral[r.id] || 0,
      created_at: r.created_at,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /referrals error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /commissions ────────────────────────────────────────────
router.get('/commissions', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('commission_events')
      .select(
        'id, event_type, plan_name, invoice_amount_cents, commission_amount_cents, stripe_invoice_id, created_at'
      )
      .eq('affiliate_id', req.affiliateId!)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /commissions DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json(data || []);
  } catch (err) {
    console.error('GET /commissions error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /payout-history ─────────────────────────────────────────
router.get('/payout-history', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('affiliate_payouts')
      .select(
        'id, period_start, period_end, amount_cents, status, stripe_transfer_id, paid_at, created_at'
      )
      .eq('affiliate_id', req.affiliateId!)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /payout-history DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json(data || []);
  } catch (err) {
    console.error('GET /payout-history error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /campaigns ──────────────────────────────────────────────
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;

    // Get affiliate code
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('affiliate_code')
      .eq('id', affiliateId)
      .single();

    if (!affiliate) {
      res.status(404).json({ error: 'Affiliate not found' });
      return;
    }

    const { data: campaigns, error } = await supabaseAdmin
      .from('affiliate_campaigns')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /campaigns DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    const result = (campaigns || []).map((c) => ({
      ...c,
      url: `${env.CLIENT_URL}/auth?ref=${affiliate.affiliate_code}&campaign=${c.slug}`,
      directUrl: `${env.CLIENT_URL}/auth?ref=${affiliate.affiliate_code}`,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /campaigns error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /campaigns ─────────────────────────────────────────────
router.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId!;
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Campaign name is required' });
      return;
    }

    // Check campaign limit
    const { count } = await supabaseAdmin
      .from('affiliate_campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', affiliateId);

    if ((count || 0) >= 20) {
      res.status(400).json({ error: 'Maximum of 20 campaigns allowed' });
      return;
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug) {
      res.status(400).json({ error: 'Campaign name must contain at least one alphanumeric character' });
      return;
    }

    const { data: campaign, error } = await supabaseAdmin
      .from('affiliate_campaigns')
      .insert({
        affiliate_id: affiliateId,
        name: name.trim(),
        slug,
        description: description || null,
      })
      .select()
      .single();

    if (error) {
      console.error('POST /campaigns DB error:', error.message);
      if (error.code === '23505') {
        res.status(409).json({ error: 'A campaign with this slug already exists' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.status(201).json(campaign);
  } catch (err) {
    console.error('POST /campaigns error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /campaigns/:id ───────────────────────────────────────
router.delete('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: campaign } = await supabaseAdmin
      .from('affiliate_campaigns')
      .select('id')
      .eq('id', id)
      .eq('affiliate_id', req.affiliateId!)
      .maybeSingle();

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('affiliate_campaigns')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('DELETE /campaigns DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    console.error('DELETE /campaigns error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /notification-preferences ───────────────────────────────
router.get('/notification-preferences', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('affiliate_notification_preferences')
      .select('*')
      .eq('affiliate_id', req.affiliateId!)
      .maybeSingle();

    if (error) {
      console.error('GET /notification-preferences DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json(data || { new_referral: true, referral_converted: true, commission_earned: true, payout_processed: true });
  } catch (err) {
    console.error('GET /notification-preferences error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /notification-preferences ───────────────────────────────
router.put('/notification-preferences', async (req: Request, res: Response) => {
  try {
    const { new_referral, referral_converted, commission_earned, payout_processed } = req.body;
    const updates: Record<string, boolean> = {};

    if (new_referral !== undefined) updates.new_referral = Boolean(new_referral);
    if (referral_converted !== undefined) updates.referral_converted = Boolean(referral_converted);
    if (commission_earned !== undefined) updates.commission_earned = Boolean(commission_earned);
    if (payout_processed !== undefined) updates.payout_processed = Boolean(payout_processed);

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('affiliate_notification_preferences')
      .upsert({ affiliate_id: req.affiliateId!, ...updates }, { onConflict: 'affiliate_id' });

    if (error) {
      console.error('PUT /notification-preferences DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json({ message: 'Notification preferences updated' });
  } catch (err) {
    console.error('PUT /notification-preferences error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /agreement ──────────────────────────────────────────────
router.get('/agreement', async (req: Request, res: Response) => {
  try {
    // Get latest agreement
    const { data: agreement, error } = await supabaseAdmin
      .from('affiliate_agreements')
      .select('id, version, terms_text, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('GET /agreement DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (!agreement) {
      res.json({ version: null, termsText: null, accepted: false, acceptedAt: null });
      return;
    }

    // Check if this affiliate accepted it
    const { data: acceptance } = await supabaseAdmin
      .from('affiliate_agreement_acceptances')
      .select('accepted_at')
      .eq('affiliate_id', req.affiliateId!)
      .eq('agreement_id', agreement.id)
      .maybeSingle();

    res.json({
      id: agreement.id,
      version: agreement.version,
      termsText: agreement.terms_text,
      accepted: !!acceptance,
      acceptedAt: acceptance?.accepted_at || null,
    });
  } catch (err) {
    console.error('GET /agreement error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /agreement/accept ──────────────────────────────────────
router.post('/agreement/accept', async (req: Request, res: Response) => {
  try {
    const { agreementId } = req.body;
    if (!agreementId) {
      res.status(400).json({ error: 'agreementId is required' });
      return;
    }

    // Verify agreement exists
    const { data: agreement } = await supabaseAdmin
      .from('affiliate_agreements')
      .select('id')
      .eq('id', agreementId)
      .maybeSingle();

    if (!agreement) {
      res.status(404).json({ error: 'Agreement not found' });
      return;
    }

    // Upsert acceptance (allow re-accepting)
    const { error } = await supabaseAdmin
      .from('affiliate_agreement_acceptances')
      .insert({
        affiliate_id: req.affiliateId!,
        agreement_id: agreementId,
      });

    if (error) {
      // If already accepted, that's fine
      if (error.code === '23505') {
        res.json({ message: 'Agreement already accepted' });
        return;
      }
      console.error('POST /agreement/accept DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.json({ message: 'Agreement accepted' });
  } catch (err) {
    console.error('POST /agreement/accept error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /connect-onboarding ────────────────────────────────────
router.post('/connect-onboarding', async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const affiliateId = req.affiliateId!;

    // 1. Get affiliate's current stripe_connect_account_id
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, email, stripe_connect_account_id')
      .eq('id', affiliateId)
      .single();

    if (!affiliate) {
      res.status(404).json({ error: 'Affiliate not found' });
      return;
    }

    let accountId = affiliate.stripe_connect_account_id;

    // 2. If none exists, create a Stripe Express account
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: affiliate.email,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;

      await supabaseAdmin
        .from('affiliates')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', affiliateId);
    }

    // 3. Create Account Link for onboarding
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${env.AFFILIATE_PORTAL_URL}/#/settings?connect=refresh`,
      return_url: `${env.AFFILIATE_PORTAL_URL}/#/settings?connect=complete`,
      type: 'account_onboarding',
    });

    // 4. Return the onboarding URL
    res.json({ url: link.url });
  } catch (err) {
    console.error('POST /connect-onboarding error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /connect-status ─────────────────────────────────────────
router.get('/connect-status', async (req: Request, res: Response) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const affiliateId = req.affiliateId!;

    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('stripe_connect_account_id')
      .eq('id', affiliateId)
      .single();

    if (!affiliate?.stripe_connect_account_id) {
      res.json({ connected: false });
      return;
    }

    const account = await stripe.accounts.retrieve(affiliate.stripe_connect_account_id);

    // If fully onboarded, update bank_account_added
    if (account.charges_enabled && account.payouts_enabled) {
      await supabaseAdmin
        .from('affiliates')
        .update({ bank_account_added: true })
        .eq('id', affiliateId);
    }

    res.json({
      connected: true,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
    });
  } catch (err) {
    console.error('GET /connect-status error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
