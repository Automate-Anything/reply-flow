import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

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
// POST /api/billing/subscribe
// Create or update the company's subscription
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

    // Verify plan exists
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

    // Get subscription + plan
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

    // ── Channels used ──────────────────────────────────
    const { count: channelsUsed } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    // ── Agents used ────────────────────────────────────
    const { count: agentsUsed } = await supabaseAdmin
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    // ── Messages used in current billing period ────────
    const { count: messagesUsed } = await supabaseAdmin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', sub.current_period_start)
      .lte('created_at', sub.current_period_end);

    // ── KB pages used ──────────────────────────────────
    // 1 page = 2000 tokens ≈ 8000 characters of text
    const { data: kbEntries, error: kbError } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('content')
      .eq('company_id', companyId);

    if (kbError) throw kbError;

    const totalChars = (kbEntries ?? []).reduce(
      (sum, entry) => sum + (entry.content?.length ?? 0),
      0
    );
    // 2000 tokens * ~4 chars/token = 8000 chars per page
    const kbPagesUsed = Math.ceil(totalChars / 8000);

    // ── Compute overages ──────────────────────────────
    const messageOverage = Math.max(0, (messagesUsed ?? 0) - plan.messages_per_month);
    const kbPageOverage = Math.max(0, kbPagesUsed - plan.kb_pages);

    const messageOverageCost = messageOverage * plan.overage_message_cents;
    const kbPageOverageCost = kbPageOverage * plan.overage_page_cents;

    res.json({
      subscription: sub,
      plan,
      usage: {
        channels: {
          used: channelsUsed ?? 0,
          included: plan.channels,
        },
        agents: {
          used: agentsUsed ?? 0,
          included: plan.agents,
        },
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
