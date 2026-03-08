import { Router, type Request, type Response, type NextFunction } from 'express';
import Stripe from 'stripe';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { extendAllCompanyChannels } from '../services/billingService.js';

const router = Router();
router.use(requireAuth);

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

// Resource limits enforced during a free trial regardless of the chosen plan
const TRIAL_LIMITS = { channels: 1, agents: 1, messages_per_month: 100, kb_pages: 3 } as const;

// Map Stripe subscription statuses to our DB statuses
const STRIPE_STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  canceled: 'cancelled',
  unpaid: 'past_due',
};

// ────────────────────────────────────────────────
// Shared helper: check if company is within plan limits
// Returns { allowed, used, included } for 'channels' or 'agents'.
// During a trial, TRIAL_LIMITS are used instead of the full plan limits.
// If no subscription exists, enforcement is skipped (allowed = true).
// ────────────────────────────────────────────────
export async function checkPlanLimit(
  companyId: string,
  resource: 'channels' | 'agents'
): Promise<{ allowed: boolean; used: number; included: number }> {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('status, plan:plans(*)')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!sub) return { allowed: true, used: 0, included: Infinity };

  const plan = sub.plan as unknown as { channels: number; agents: number };
  const baseIncluded = sub.status === 'trialing' ? TRIAL_LIMITS[resource] : plan[resource];

  // Add any purchased add-ons to the base limit
  const addonId = resource === 'channels' ? 'extra_channel' : 'extra_agent';
  const { data: addonRow } = await supabaseAdmin
    .from('company_addons')
    .select('quantity')
    .eq('company_id', companyId)
    .eq('addon_id', addonId)
    .maybeSingle();
  const addonQty = addonRow?.quantity ?? 0;
  const included = baseIncluded + addonQty;

  const table = resource === 'channels' ? 'whatsapp_channels' : 'ai_agents';
  const { count } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  const used = count ?? 0;
  return { allowed: used < included, used, included };
}

// ────────────────────────────────────────────────
// GET /api/billing/subscription
// Returns the company's current subscription + plan.
// ────────────────────────────────────────────────
router.get('/subscription', requirePermission('billing', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*, plan:plans(*)')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) throw error;

    res.json({ subscription: data ?? null });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/create-checkout-session
// Creates a Stripe Checkout session for a new subscription.
// Body: { plan_id: 'starter' | 'pro' | 'scale', with_trial?: boolean }
// Pass with_trial: true to start the subscription with a 7-day free trial.
// Returns: { url } — redirect the user to this URL
// ────────────────────────────────────────────────
router.post('/create-checkout-session', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { plan_id, with_trial } = req.body;
    if (!plan_id) {
      res.status(400).json({ error: 'plan_id is required' });
      return;
    }

    // Trials are one-per-company: check the permanent has_used_trial flag on
    // the company so this survives subscription cancellations / replacements.
    if (with_trial) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('has_used_trial')
        .eq('id', companyId)
        .maybeSingle();
      if (company?.has_used_trial) {
        res.status(400).json({ error: 'Free trial has already been used for this account.' });
        return;
      }
    }

    // Look up the plan and its Stripe price ID
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, stripe_price_id')
      .eq('id', plan_id)
      .eq('is_active', true)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan) {
      res.status(400).json({ error: 'Invalid plan' });
      return;
    }
    if (!plan.stripe_price_id) {
      res.status(503).json({ error: 'This plan is not yet connected to Stripe. Please add the stripe_price_id to the plans table.' });
      return;
    }

    // Reuse existing Stripe customer if the company has one
    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      metadata: { company_id: companyId, plan_id },
      success_url: `${env.CLIENT_URL}/settings?tab=billing&success=true`,
      cancel_url: `${env.CLIENT_URL}/settings?tab=billing`,
    };

    if (with_trial) {
      sessionParams.subscription_data = { trial_period_days: 7 };
    }

    if (existingSub?.stripe_customer_id) {
      sessionParams.customer = existingSub.stripe_customer_id;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/portal
// Creates a Stripe Customer Portal session for managing an existing subscription.
// Returns: { url } — redirect the user to this URL
// ────────────────────────────────────────────────
router.post('/portal', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_customer_id) {
      res.status(400).json({ error: 'No Stripe customer found. Please subscribe first.' });
      return;
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${env.CLIENT_URL}/settings?tab=billing`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/subscribe  (kept for backward-compat / admin use)
// Direct DB subscription without Stripe — use checkout-session for real payments
// Body: { plan_id: 'starter' | 'pro' | 'scale' }
// ────────────────────────────────────────────────
router.post('/subscribe', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { plan_id } = req.body;
    if (!plan_id) {
      res.status(400).json({ error: 'plan_id is required' });
      return;
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('id', plan_id)
      .eq('is_active', true)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan) {
      res.status(400).json({ error: 'Invalid plan' });
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .upsert(
        {
          company_id: companyId,
          plan_id,
          status: 'active',
          current_period_start: now.toISOString().split('T')[0],
          current_period_end: periodEnd.toISOString().split('T')[0],
        },
        { onConflict: 'company_id' }
      )
      .select('*, plan:plans(*)')
      .single();

    if (error) throw error;

    res.json({ subscription: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/skip-trial
// Ends the Stripe trial immediately and starts billing now.
// The subscription switches from trialing → active and the first charge fires.
// ────────────────────────────────────────────────
router.post('/skip-trial', async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      res.status(400).json({ error: 'No active Stripe subscription found.' });
      return;
    }
    if (sub.status !== 'trialing') {
      res.status(400).json({ error: 'No active trial to skip.' });
      return;
    }

    // Setting trial_end: 'now' immediately ends the trial and triggers billing
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      trial_end: 'now',
    });

    // The customer.subscription.updated webhook will sync the status to 'active'
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/change-plan
// Upgrades or downgrades an existing Stripe subscription immediately with proration.
// Body: { plan_id: 'starter' | 'pro' | 'scale' }
// ────────────────────────────────────────────────
router.post('/change-plan', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { plan_id } = req.body;
    if (!plan_id) {
      res.status(400).json({ error: 'plan_id is required' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, plan_id')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      res.status(400).json({ error: 'No active Stripe subscription found.' });
      return;
    }

    if (sub.plan_id === plan_id) {
      res.status(400).json({ error: 'You are already on this plan.' });
      return;
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, stripe_price_id')
      .eq('id', plan_id)
      .eq('is_active', true)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan?.stripe_price_id) {
      res.status(400).json({ error: 'Invalid plan or plan not connected to Stripe.' });
      return;
    }

    // Retrieve the current subscription to find the subscription item ID
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) {
      res.status(500).json({ error: 'Could not find subscription item.' });
      return;
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: itemId, price: plan.stripe_price_id }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false, // Clear any pending cancellation on plan change
    });

    // Optimistically update plan_id and clear cancel_at_period_end in DB now.
    // The webhook (customer.subscription.updated) will also sync shortly.
    await supabaseAdmin
      .from('subscriptions')
      .update({ plan_id, cancel_at_period_end: false })
      .eq('company_id', companyId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/cancel
// Schedules the subscription to cancel at the end of the current billing period
// (or at the end of the trial period if currently trialing — no charge is made).
// ────────────────────────────────────────────────
router.post('/cancel', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      res.status(400).json({ error: 'No active Stripe subscription found.' });
      return;
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('company_id', companyId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/reactivate
// Cancels a scheduled cancellation, keeping the subscription active.
// ────────────────────────────────────────────────
router.post('/reactivate', requirePermission('billing', 'manage'), async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      res.status(400).json({ error: 'No active Stripe subscription found.' });
      return;
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: false })
      .eq('company_id', companyId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET /api/billing/usage
// Returns usage stats for the current billing period.
// During a trial, TRIAL_LIMITS are used for channel/agent/message/kb_page counts.
// ────────────────────────────────────────────────
router.get('/usage', requirePermission('billing', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*, plan:plans(*)')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;

    if (!sub) {
      res.json({ subscription: null, plan: null, usage: null });
      return;
    }

    const plan = sub.plan as {
      channels: number;
      agents: number;
      messages_per_month: number;
      kb_pages: number;
      overage_message_cents: number;
      overage_page_cents: number;
    };

    // During a trial, enforce fixed trial limits instead of the full plan limits
    const isTrialing = sub.status === 'trialing';
    const baseChannels = isTrialing ? TRIAL_LIMITS.channels : plan.channels;
    const baseAgents = isTrialing ? TRIAL_LIMITS.agents : plan.agents;
    const includedMessages = isTrialing ? TRIAL_LIMITS.messages_per_month : plan.messages_per_month;
    const includedKbPages = isTrialing ? TRIAL_LIMITS.kb_pages : plan.kb_pages;

    // Add purchased add-ons to base channel/agent limits
    const [{ data: channelAddon }, { data: agentAddon }] = await Promise.all([
      supabaseAdmin
        .from('company_addons')
        .select('quantity')
        .eq('company_id', companyId)
        .eq('addon_id', 'extra_channel')
        .maybeSingle(),
      supabaseAdmin
        .from('company_addons')
        .select('quantity')
        .eq('company_id', companyId)
        .eq('addon_id', 'extra_agent')
        .maybeSingle(),
    ]);
    const includedChannels = baseChannels + (channelAddon?.quantity ?? 0);
    const includedAgents = baseAgents + (agentAddon?.quantity ?? 0);

    const { count: channelsUsed } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    const { count: agentsUsed } = await supabaseAdmin
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    const { count: messagesUsed } = await supabaseAdmin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', sub.current_period_start)
      .lte('created_at', sub.current_period_end);

    const { data: kbEntries, error: kbError } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('content')
      .eq('company_id', companyId);

    if (kbError) throw kbError;

    const totalChars = (kbEntries ?? []).reduce(
      (sum, entry) => sum + (entry.content?.length ?? 0),
      0
    );
    const kbPagesUsed = Math.ceil(totalChars / 8000);

    // Overage is $0 during trial (no billing for overages while trialing)
    const messageOverage = isTrialing ? 0 : Math.max(0, (messagesUsed ?? 0) - includedMessages);
    const kbPageOverage = isTrialing ? 0 : Math.max(0, kbPagesUsed - includedKbPages);
    const messageOverageCost = messageOverage * plan.overage_message_cents;
    const kbPageOverageCost = kbPageOverage * plan.overage_page_cents;

    res.json({
      subscription: sub,
      plan,
      usage: {
        channels: { used: channelsUsed ?? 0, included: includedChannels },
        agents: { used: agentsUsed ?? 0, included: includedAgents },
        messages: {
          used: messagesUsed ?? 0,
          included: includedMessages,
          overage: messageOverage,
          overage_cost_cents: messageOverageCost,
        },
        kb_pages: {
          used: kbPagesUsed,
          included: includedKbPages,
          overage: kbPageOverage,
          overage_cost_cents: kbPageOverageCost,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET /api/billing/balance
// Returns the company's prepaid balance and auto top-up configuration.
// ────────────────────────────────────────────────
router.get('/balance', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const [{ data: balanceRow }, { data: sub }] = await Promise.all([
      supabaseAdmin
        .from('company_balances')
        .select('balance_cents, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents')
        .eq('company_id', companyId)
        .maybeSingle(),
      supabaseAdmin
        .from('subscriptions')
        .select('first_paid_at, renewal_failed_at, grace_period_ends_at')
        .eq('company_id', companyId)
        .maybeSingle(),
    ]);

    res.json({
      balance_cents: balanceRow?.balance_cents ?? 0,
      auto_topup_enabled: balanceRow?.auto_topup_enabled ?? false,
      auto_topup_threshold_cents: balanceRow?.auto_topup_threshold_cents ?? null,
      auto_topup_amount_cents: balanceRow?.auto_topup_amount_cents ?? null,
      first_paid_at: sub?.first_paid_at ?? null,
      renewal_failed_at: sub?.renewal_failed_at ?? null,
      grace_period_ends_at: sub?.grace_period_ends_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/configure-auto-topup
// Enables / disables auto top-up and sets threshold + amount.
// Body: { enabled: boolean, threshold_cents?: number, amount_cents?: number }
// ────────────────────────────────────────────────
router.post('/configure-auto-topup', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { enabled, threshold_cents, amount_cents } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    if (enabled) {
      if (!threshold_cents || threshold_cents < 100) {
        res.status(400).json({ error: 'threshold_cents must be at least 100 ($1.00)' });
        return;
      }
      if (!amount_cents || amount_cents < 500) {
        res.status(400).json({ error: 'amount_cents must be at least 500 ($5.00)' });
        return;
      }
    }

    const { error } = await supabaseAdmin
      .from('company_balances')
      .upsert(
        {
          company_id: companyId,
          auto_topup_enabled: enabled,
          auto_topup_threshold_cents: enabled ? threshold_cents : null,
          auto_topup_amount_cents: enabled ? amount_cents : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id' }
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/topup
// Creates a Stripe Checkout session for a one-time balance top-up.
// Body: { amount_cents: number } — minimum 500 ($5.00)
// Returns: { url } — redirect the user to this URL
// ────────────────────────────────────────────────
router.post('/topup', async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { amount_cents } = req.body;
    if (!amount_cents || amount_cents < 500) {
      res.status(400).json({ error: 'amount_cents must be at least 500 ($5.00)' });
      return;
    }

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount_cents,
            product_data: {
              name: 'AI Message Credits',
              description: `$${(amount_cents / 100).toFixed(2)} balance top-up for AI message overages`,
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: {
          type: 'balance_topup',
          topup_source: 'manual',
          company_id: companyId,
          amount_cents: String(amount_cents),
        },
      },
      metadata: {
        type: 'balance_topup',
        company_id: companyId,
        amount_cents: String(amount_cents),
      },
      success_url: `${env.CLIENT_URL}/settings?tab=billing&topup=success`,
      cancel_url: `${env.CLIENT_URL}/settings?tab=billing`,
    };

    if (sub?.stripe_customer_id) {
      sessionParams.customer = sub.stripe_customer_id;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET /api/billing/addons
// Returns available add-on products and the company's currently purchased add-ons.
// ────────────────────────────────────────────────
router.get('/addons', async (req, res, next) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const [{ data: products }, { data: purchased }] = await Promise.all([
      supabaseAdmin
        .from('addon_products')
        .select('id, name, description, price_monthly_cents')
        .eq('is_active', true)
        .order('price_monthly_cents', { ascending: false }),
      supabaseAdmin
        .from('company_addons')
        .select('addon_id, quantity')
        .eq('company_id', companyId),
    ]);

    res.json({
      available: products ?? [],
      purchased: purchased ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/addons/purchase
// Adds one unit of an add-on to the company's Stripe subscription.
// Body: { addon_id: 'extra_channel' | 'extra_agent' }
// ────────────────────────────────────────────────
router.post('/addons/purchase', async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { addon_id } = req.body;
    if (!addon_id) {
      res.status(400).json({ error: 'addon_id is required' });
      return;
    }

    // Look up the add-on product
    const { data: product, error: productError } = await supabaseAdmin
      .from('addon_products')
      .select('id, name, stripe_price_id')
      .eq('id', addon_id)
      .eq('is_active', true)
      .maybeSingle();

    if (productError) throw productError;
    if (!product) {
      res.status(400).json({ error: 'Invalid or inactive add-on' });
      return;
    }
    if (!product.stripe_price_id) {
      res.status(503).json({ error: 'This add-on is not yet connected to Stripe. Please set the stripe_price_id in addon_products.' });
      return;
    }

    // Require an active (non-trialing) Stripe subscription
    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('company_id', companyId)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.stripe_subscription_id) {
      res.status(400).json({ error: 'No active Stripe subscription found.' });
      return;
    }
    if (sub.status !== 'active') {
      res.status(400).json({ error: 'Add-ons can only be purchased on an active (non-trial) subscription.' });
      return;
    }

    // Check if this add-on price already exists as a subscription item
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const existingItem = stripeSub.items.data.find(
      (item) => item.price.id === product.stripe_price_id
    );

    let stripeItemId: string;
    let newQuantity: number;

    if (existingItem) {
      newQuantity = existingItem.quantity! + 1;
      await stripe.subscriptionItems.update(existingItem.id, { quantity: newQuantity });
      stripeItemId = existingItem.id;
    } else {
      const newItem = await stripe.subscriptionItems.create({
        subscription: sub.stripe_subscription_id,
        price: product.stripe_price_id,
        quantity: 1,
        proration_behavior: 'create_prorations',
      });
      stripeItemId = newItem.id;
      newQuantity = 1;
    }

    // Upsert into company_addons
    const { data: existing } = await supabaseAdmin
      .from('company_addons')
      .select('quantity')
      .eq('company_id', companyId)
      .eq('addon_id', addon_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('company_addons')
        .update({ quantity: newQuantity, stripe_subscription_item_id: stripeItemId, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('addon_id', addon_id);
    } else {
      await supabaseAdmin
        .from('company_addons')
        .insert({ company_id: companyId, addon_id, quantity: newQuantity, stripe_subscription_item_id: stripeItemId });
    }

    res.json({ success: true, quantity: newQuantity });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// POST /api/billing/addons/remove
// Removes one unit of an add-on from the company's Stripe subscription.
// If quantity reaches 0 the subscription item is deleted entirely.
// Body: { addon_id: 'extra_channel' | 'extra_agent' }
// ────────────────────────────────────────────────
router.post('/addons/remove', async (req, res, next) => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured' });
      return;
    }

    const companyId = req.companyId;
    if (!companyId) {
      res.status(400).json({ error: 'No company associated with this account' });
      return;
    }

    const { addon_id } = req.body;
    if (!addon_id) {
      res.status(400).json({ error: 'addon_id is required' });
      return;
    }

    const { data: addonRow, error: addonError } = await supabaseAdmin
      .from('company_addons')
      .select('quantity, stripe_subscription_item_id')
      .eq('company_id', companyId)
      .eq('addon_id', addon_id)
      .maybeSingle();

    if (addonError) throw addonError;
    if (!addonRow) {
      res.status(400).json({ error: 'No add-on of this type is currently active.' });
      return;
    }

    const itemId = addonRow.stripe_subscription_item_id;
    const newQuantity = addonRow.quantity - 1;

    if (itemId) {
      if (newQuantity > 0) {
        await stripe.subscriptionItems.update(itemId, { quantity: newQuantity });
      } else {
        await stripe.subscriptionItems.del(itemId, { proration_behavior: 'create_prorations' });
      }
    }

    if (newQuantity > 0) {
      await supabaseAdmin
        .from('company_addons')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('addon_id', addon_id);
    } else {
      await supabaseAdmin
        .from('company_addons')
        .delete()
        .eq('company_id', companyId)
        .eq('addon_id', addon_id);
    }

    res.json({ success: true, quantity: newQuantity });
  } catch (err) {
    next(err);
  }
});

export default router;

// ────────────────────────────────────────────────
// Stripe Webhook Handler
// Exported separately so it can be mounted in index.ts BEFORE express.json()
// (Stripe requires the raw request body for signature verification)
// ────────────────────────────────────────────────
export async function stripeWebhookHandler(req: Request, res: Response, next: NextFunction) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: 'Stripe is not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.status(400).json({ error: `Webhook signature verification failed` });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Handle manual balance top-up checkouts
        if (session.metadata?.type === 'balance_topup') {
          const { company_id, amount_cents } = session.metadata;
          if (!company_id || !amount_cents) break;
          const credits = parseInt(amount_cents, 10);

          await supabaseAdmin
            .from('company_balances')
            .upsert(
              { company_id, balance_cents: 0 },
              { onConflict: 'company_id', ignoreDuplicates: true }
            );

          await supabaseAdmin.rpc('credit_company_balance', {
            p_company_id: company_id,
            p_amount_cents: credits,
            p_type: 'topup_manual',
            p_description: `Manual top-up: $${(credits / 100).toFixed(2)}`,
            p_stripe_pi_id: session.payment_intent as string ?? null,
          });
          break;
        }

        // Regular subscription checkout
        const { company_id, plan_id } = session.metadata ?? {};
        if (!company_id || !plan_id) break;

        const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
        const subItem = stripeSub.items.data[0];
        const periodStart = new Date(subItem.current_period_start * 1000).toISOString().split('T')[0];
        const periodEnd = new Date(subItem.current_period_end * 1000).toISOString().split('T')[0];
        const status = STRIPE_STATUS_MAP[stripeSub.status] ?? 'active';
        const trialEndsAt = stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000).toISOString()
          : null;

        await supabaseAdmin
          .from('subscriptions')
          .upsert(
            {
              company_id,
              plan_id,
              status,
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              trial_ends_at: trialEndsAt,
            },
            { onConflict: 'company_id' }
          );

        // Permanently record that this company has used their free trial
        if (status === 'trialing') {
          await supabaseAdmin
            .from('companies')
            .update({ has_used_trial: true })
            .eq('id', company_id);
        }

        // Extend Whapi channels for companies that already have channels set up
        if (status === 'trialing' && trialEndsAt) {
          const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
          const days = Math.max(1, Math.ceil(msRemaining / 86_400_000));
          await extendAllCompanyChannels(company_id, days);
        } else if (status === 'active') {
          await extendAllCompanyChannels(company_id, 30);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;

        // Find the plan item — iterate all items since add-ons may also be present
        const allPriceIds = stripeSub.items.data.map((item) => item.price.id);
        const { data: planRows } = await supabaseAdmin
          .from('plans')
          .select('id, stripe_price_id')
          .in('stripe_price_id', allPriceIds);
        const plan = planRows?.[0] ?? null;

        const subItem = stripeSub.items.data[0];
        const periodStart = new Date(subItem.current_period_start * 1000).toISOString().split('T')[0];
        const periodEnd = new Date(subItem.current_period_end * 1000).toISOString().split('T')[0];
        const status = STRIPE_STATUS_MAP[stripeSub.status] ?? 'past_due';
        const trialEndsAt = stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000).toISOString()
          : null;

        await supabaseAdmin
          .from('subscriptions')
          .update({
            ...(plan ? { plan_id: plan.id } : {}),
            status,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            cancel_at_period_end: stripeSub.cancel_at_period_end,
            trial_ends_at: trialEndsAt,
          })
          .eq('stripe_subscription_id', stripeSub.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', stripeSub.id);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer) break;

        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('id, company_id, first_paid_at')
          .eq('stripe_customer_id', invoice.customer as string)
          .maybeSingle();

        if (!sub) break;

        const updates: Record<string, unknown> = {
          renewal_failed_at: null,
          grace_period_ends_at: null,
        };
        if (!sub.first_paid_at) {
          updates.first_paid_at = new Date().toISOString();
        }

        await supabaseAdmin
          .from('subscriptions')
          .update(updates)
          .eq('id', sub.id);

        // Extend all Whapi channels for the new billing period
        await extendAllCompanyChannels(sub.company_id, 30);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer) break;

        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('id, first_paid_at')
          .eq('stripe_customer_id', invoice.customer as string)
          .maybeSingle();

        if (!sub) break;

        const now = new Date();
        const updates: Record<string, unknown> = {
          renewal_failed_at: now.toISOString(),
        };

        // Only set a grace period if the company has paid at least once before
        if (sub.first_paid_at) {
          const gracePeriodEnd = new Date(now.getTime() + 14 * 86_400_000);
          updates.grace_period_ends_at = gracePeriodEnd.toISOString();
        }

        await supabaseAdmin
          .from('subscriptions')
          .update(updates)
          .eq('id', sub.id);
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.type !== 'balance_topup') break;

        const { company_id, amount_cents } = pi.metadata;
        if (!company_id || !amount_cents) break;

        const credits = parseInt(amount_cents, 10);

        await supabaseAdmin.rpc('credit_company_balance', {
          p_company_id: company_id,
          p_amount_cents: credits,
          p_type: pi.metadata.topup_source === 'auto' ? 'topup_auto' : 'topup_manual',
          p_description: `Balance top-up: $${(credits / 100).toFixed(2)}`,
          p_stripe_pi_id: pi.id,
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}
