import { Router, type Request, type Response, type NextFunction } from 'express';
import Stripe from 'stripe';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

// ────────────────────────────────────────────────
// Shared helper: check if company is within plan limits
// Returns { allowed, used, included } for 'channels' or 'agents'
// If no subscription exists, enforcement is skipped (allowed = true)
// ────────────────────────────────────────────────
export async function checkPlanLimit(
  companyId: string,
  resource: 'channels' | 'agents'
): Promise<{ allowed: boolean; used: number; included: number }> {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*, plan:plans(*)')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!sub) return { allowed: true, used: 0, included: Infinity };

  const plan = sub.plan as { channels: number; agents: number };
  const table = resource === 'channels' ? 'whatsapp_channels' : 'ai_agents';

  const { count } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  const used = count ?? 0;
  const included = plan[resource];
  return { allowed: used < included, used, included };
}

// ────────────────────────────────────────────────
// GET /api/billing/subscription
// Returns the company's current subscription + plan
// ────────────────────────────────────────────────
router.get('/subscription', async (req, res, next) => {
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
// Body: { plan_id: 'starter' | 'pro' | 'scale' }
// Returns: { url } — redirect the user to this URL
// ────────────────────────────────────────────────
router.post('/create-checkout-session', async (req, res, next) => {
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
router.post('/portal', async (req, res, next) => {
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
router.post('/subscribe', async (req, res, next) => {
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
// GET /api/billing/usage
// Returns usage stats for the current billing period
// ────────────────────────────────────────────────
router.get('/usage', async (req, res, next) => {
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

    const messageOverage = Math.max(0, (messagesUsed ?? 0) - plan.messages_per_month);
    const kbPageOverage = Math.max(0, kbPagesUsed - plan.kb_pages);

    const messageOverageCost = messageOverage * plan.overage_message_cents;
    const kbPageOverageCost = kbPageOverage * plan.overage_page_cents;

    res.json({
      subscription: sub,
      plan,
      usage: {
        channels: { used: channelsUsed ?? 0, included: plan.channels },
        agents: { used: agentsUsed ?? 0, included: plan.agents },
        messages: {
          used: messagesUsed ?? 0,
          included: plan.messages_per_month,
          overage: messageOverage,
          overage_cost_cents: messageOverageCost,
        },
        kb_pages: {
          used: kbPagesUsed,
          included: plan.kb_pages,
          overage: kbPageOverage,
          overage_cost_cents: kbPageOverageCost,
        },
      },
    });
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
        const { company_id, plan_id } = session.metadata ?? {};
        if (!company_id || !plan_id) break;

        // Retrieve full subscription from Stripe for period dates
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
        const subItem = stripeSub.items.data[0];
        const periodStart = new Date(subItem.current_period_start * 1000).toISOString().split('T')[0];
        const periodEnd = new Date(subItem.current_period_end * 1000).toISOString().split('T')[0];

        await supabaseAdmin
          .from('subscriptions')
          .upsert(
            {
              company_id,
              plan_id,
              status: 'active',
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              current_period_start: periodStart,
              current_period_end: periodEnd,
            },
            { onConflict: 'company_id' }
          );
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const priceId = stripeSub.items.data[0]?.price?.id;

        // Look up our plan by stripe_price_id
        const { data: plan } = await supabaseAdmin
          .from('plans')
          .select('id')
          .eq('stripe_price_id', priceId)
          .maybeSingle();

        const subItem = stripeSub.items.data[0];
        const periodStart = new Date(subItem.current_period_start * 1000).toISOString().split('T')[0];
        const periodEnd = new Date(subItem.current_period_end * 1000).toISOString().split('T')[0];

        // Map Stripe status to our status
        const statusMap: Record<string, string> = {
          active: 'active',
          trialing: 'trialing',
          past_due: 'past_due',
          canceled: 'cancelled',
          unpaid: 'past_due',
        };
        const status = statusMap[stripeSub.status] ?? 'past_due';

        await supabaseAdmin
          .from('subscriptions')
          .update({
            ...(plan ? { plan_id: plan.id } : {}),
            status,
            current_period_start: periodStart,
            current_period_end: periodEnd,
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
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}
