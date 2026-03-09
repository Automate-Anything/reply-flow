/**
 * billingService.ts
 * Shared billing helpers used by the billing routes and the message processor.
 */

import Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import * as whapi from './whapi.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

// Trial resource limits (same as in billing.ts)
const TRIAL_LIMITS = { messages_per_month: 100 } as const;

// ────────────────────────────────────────────────────────────────────────────
// checkMessageAllowance
// Determines whether the AI is allowed to respond to the next message.
//
// Returns:
//   allowed            — false means skip the AI response entirely
//   reason             — why it was blocked
//   isOverLimit        — true when allowed but consuming from balance
//   overageMessageCents — plan's per-message overage cost (needed for deduction)
//   autoTopupEnabled   — whether auto top-up is configured
//   autoTopupThresholdCents — threshold to trigger auto top-up
// ────────────────────────────────────────────────────────────────────────────
export interface MessageAllowance {
  allowed: boolean;
  reason?: 'grace_period' | 'over_limit_no_balance';
  isOverLimit: boolean;
  overageMessageCents: number;
  autoTopupEnabled: boolean;
  autoTopupThresholdCents: number;
}

export async function checkMessageAllowance(companyId: string): Promise<MessageAllowance> {
  const defaults: MessageAllowance = {
    allowed: true,
    isOverLimit: false,
    overageMessageCents: 0,
    autoTopupEnabled: false,
    autoTopupThresholdCents: 0,
  };

  // Fetch subscription + plan
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('status, grace_period_ends_at, current_period_start, current_period_end, plan:plans(messages_per_month, overage_message_cents)')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!sub) return defaults; // No subscription — no enforcement

  // Block if grace period has passed (or is active — "everything stops working")
  if (sub.grace_period_ends_at) {
    return {
      ...defaults,
      allowed: false,
      reason: 'grace_period',
    };
  }

  // Block for past_due and cancelled subscriptions outside of grace period handling
  if (sub.status === 'past_due' || sub.status === 'cancelled') {
    return {
      ...defaults,
      allowed: false,
      reason: 'grace_period',
    };
  }

  const plan = sub.plan as unknown as { messages_per_month: number; overage_message_cents: number };
  const isTrialing = sub.status === 'trialing';
  const includedMessages = isTrialing ? TRIAL_LIMITS.messages_per_month : plan.messages_per_month;

  // Count messages in current billing period
  const { count: messagesUsed } = await supabaseAdmin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', sub.current_period_start)
    .lte('created_at', sub.current_period_end);

  if ((messagesUsed ?? 0) < includedMessages) {
    return defaults; // Within included limit
  }

  // Over the included limit — check balance
  const { data: balanceRow } = await supabaseAdmin
    .from('company_balances')
    .select('balance_cents, auto_topup_enabled, auto_topup_threshold_cents')
    .eq('company_id', companyId)
    .maybeSingle();

  const balanceCents = balanceRow?.balance_cents ?? 0;
  const autoTopupEnabled = balanceRow?.auto_topup_enabled ?? false;
  const autoTopupThresholdCents = balanceRow?.auto_topup_threshold_cents ?? 0;

  if (balanceCents > 0) {
    return {
      allowed: true,
      isOverLimit: true,
      overageMessageCents: plan.overage_message_cents,
      autoTopupEnabled,
      autoTopupThresholdCents,
    };
  }

  return {
    ...defaults,
    allowed: false,
    reason: 'over_limit_no_balance',
    isOverLimit: true,
    overageMessageCents: plan.overage_message_cents,
    autoTopupEnabled,
    autoTopupThresholdCents,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// deductOverageBalance
// Atomically deducts the per-message overage cost from the company's balance
// via a Postgres RPC (prevents race conditions).
// Returns the new balance after deduction.
// ────────────────────────────────────────────────────────────────────────────
export async function deductOverageBalance(
  companyId: string,
  overageMessageCents: number
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('deduct_message_balance', {
    p_company_id: companyId,
    p_amount_cents: overageMessageCents,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ────────────────────────────────────────────────────────────────────────────
// triggerAutoTopup
// Creates a Stripe PaymentIntent using the customer's default payment method.
// Fire-and-forget — the payment_intent.succeeded webhook credits the balance.
// Silently does nothing if Stripe is not configured or no payment method.
// ────────────────────────────────────────────────────────────────────────────
export async function triggerAutoTopup(companyId: string): Promise<void> {
  if (!stripe) return;

  const { data: balanceRow } = await supabaseAdmin
    .from('company_balances')
    .select('auto_topup_enabled, auto_topup_amount_cents')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!balanceRow?.auto_topup_enabled || !balanceRow.auto_topup_amount_cents) return;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!sub?.stripe_customer_id) return;

  // Retrieve the customer's default payment method
  const customer = await stripe.customers.retrieve(sub.stripe_customer_id, {
    expand: ['invoice_settings.default_payment_method'],
  });

  if (customer.deleted) return;

  const pm = customer.invoice_settings?.default_payment_method;
  const pmId = typeof pm === 'string' ? pm : pm?.id;
  if (!pmId) {
    console.warn(`[billingService] Auto top-up skipped for ${companyId}: no default payment method`);
    return;
  }

  await stripe.paymentIntents.create({
    amount: balanceRow.auto_topup_amount_cents,
    currency: 'usd',
    customer: sub.stripe_customer_id,
    payment_method: pmId,
    confirm: true,
    off_session: true,
    metadata: {
      type: 'balance_topup',
      topup_source: 'auto',
      company_id: companyId,
      amount_cents: String(balanceRow.auto_topup_amount_cents),
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// extendAllCompanyChannels
// Extends every Whapi channel for a company by the given number of days.
// Used when a payment succeeds (monthly renewal = 30 days, trial = 7 days).
// Errors per channel are logged and swallowed so other channels aren't affected.
// ────────────────────────────────────────────────────────────────────────────
export async function extendAllCompanyChannels(companyId: string, days: number): Promise<void> {
  const { data: channels } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_id')
    .eq('company_id', companyId);

  if (!channels?.length) return;

  await Promise.allSettled(
    channels.map(async (ch) => {
      try {
        await whapi.extendChannel(ch.channel_id, days);
      } catch (err) {
        console.error(`[billingService] extendChannel failed for ${ch.channel_id}:`, err);
      }
    })
  );
}
