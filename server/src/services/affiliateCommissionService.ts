import { supabaseAdmin } from '../config/supabase.js';

// ── Types ────────────────────────────────────────────────────────

interface CommissionResult {
  shouldPay: boolean;
  amountCents: number;
  rate: number;
  commissionType: 'percentage' | 'flat';
}

type EventType = 'signup' | 'renewal' | 'upgrade' | 'downgrade' | 'churn';

// ── calculateCommission ──────────────────────────────────────────

export async function calculateCommission(
  referralId: string,
  invoiceAmountCents: number
): Promise<CommissionResult> {
  // 1. Fetch referral with schedule + payment_count
  const { data: referral } = await supabaseAdmin
    .from('affiliate_referrals')
    .select('id, affiliate_id, commission_schedule_id, payment_count')
    .eq('id', referralId)
    .single();

  if (!referral) {
    return { shouldPay: false, amountCents: 0, rate: 0, commissionType: 'percentage' };
  }

  const scheduleId = referral.commission_schedule_id;
  const paymentCount = referral.payment_count ?? 0;

  // 2. If no schedule, fall back to affiliate-level commission settings
  if (!scheduleId) {
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('commission_type, commission_rate')
      .eq('id', referral.affiliate_id)
      .single();

    if (!affiliate || affiliate.commission_rate == null) {
      return { shouldPay: false, amountCents: 0, rate: 0, commissionType: 'percentage' };
    }

    const type = (affiliate.commission_type as 'percentage' | 'flat') || 'percentage';
    const rate = affiliate.commission_rate;
    const amountCents =
      type === 'percentage'
        ? Math.round(invoiceAmountCents * rate / 100)
        : rate; // flat rate is already in cents

    return { shouldPay: amountCents > 0, amountCents, rate, commissionType: type };
  }

  // 3. Schedule exists — fetch schedule + periods
  const { data: schedule } = await supabaseAdmin
    .from('commission_schedules')
    .select('id, commission_type, end_behavior, end_rate')
    .eq('id', scheduleId)
    .single();

  if (!schedule) {
    return { shouldPay: false, amountCents: 0, rate: 0, commissionType: 'percentage' };
  }

  const { data: periods } = await supabaseAdmin
    .from('commission_schedule_periods')
    .select('from_payment, to_payment, rate')
    .eq('schedule_id', scheduleId)
    .order('from_payment', { ascending: true });

  const commissionType = (schedule.commission_type as 'percentage' | 'flat') || 'percentage';

  // Find matching period
  const matchingPeriod = (periods || []).find(
    (p) => paymentCount >= p.from_payment && paymentCount <= p.to_payment
  );

  let rate: number;

  if (matchingPeriod) {
    rate = matchingPeriod.rate;
  } else {
    // No matching period — apply end_behavior
    switch (schedule.end_behavior) {
      case 'stop':
        return { shouldPay: false, amountCents: 0, rate: 0, commissionType };
      case 'continue_last': {
        const lastPeriod = (periods || []).at(-1);
        if (!lastPeriod) {
          return { shouldPay: false, amountCents: 0, rate: 0, commissionType };
        }
        rate = lastPeriod.rate;
        break;
      }
      case 'custom_rate':
        rate = schedule.end_rate ?? 0;
        break;
      default:
        return { shouldPay: false, amountCents: 0, rate: 0, commissionType };
    }
  }

  // 4. Calculate amount
  const amountCents =
    commissionType === 'percentage'
      ? Math.round(invoiceAmountCents * rate / 100)
      : rate;

  return { shouldPay: amountCents > 0, amountCents, rate, commissionType };
}

// ── detectEventType ──────────────────────────────────────────────

export async function detectEventType(
  paymentCount: number,
  currentPlanName: string | null,
  lastPlanName: string | null
): Promise<EventType> {
  if (paymentCount === 1) return 'signup';

  if (!currentPlanName || !lastPlanName || currentPlanName === lastPlanName) {
    return 'renewal';
  }

  // Compare plan prices from the plans table
  const { data: plans } = await supabaseAdmin
    .from('plans')
    .select('name, price_monthly_cents')
    .in('name', [currentPlanName, lastPlanName]);

  if (!plans || plans.length < 2) return 'renewal';

  const currentPlan = plans.find((p) => p.name === currentPlanName);
  const lastPlan = plans.find((p) => p.name === lastPlanName);

  if (!currentPlan || !lastPlan) return 'renewal';

  if (currentPlan.price_monthly_cents > lastPlan.price_monthly_cents) return 'upgrade';
  if (currentPlan.price_monthly_cents < lastPlan.price_monthly_cents) return 'downgrade';

  return 'renewal';
}

// ── processInvoicePaidForAffiliate ───────────────────────────────

export async function processInvoicePaidForAffiliate(
  companyId: string,
  invoiceAmountCents: number,
  planName: string | null,
  stripeInvoiceId: string
): Promise<void> {
  // 1. Find referral for this company
  const { data: referral } = await supabaseAdmin
    .from('affiliate_referrals')
    .select('id, affiliate_id, payment_count, last_plan_name, status')
    .eq('company_id', companyId)
    .in('status', ['pending', 'trialing', 'active'])
    .maybeSingle();

  if (!referral) return; // Not an affiliate referral

  // 2. Increment payment_count
  const newPaymentCount = (referral.payment_count ?? 0) + 1;
  await supabaseAdmin
    .from('affiliate_referrals')
    .update({ payment_count: newPaymentCount })
    .eq('id', referral.id);

  // 3. Detect event type
  const eventType = await detectEventType(
    newPaymentCount,
    planName,
    referral.last_plan_name
  );

  // 4. Update last_plan_name
  if (planName) {
    await supabaseAdmin
      .from('affiliate_referrals')
      .update({ last_plan_name: planName })
      .eq('id', referral.id);
  }

  // 5. Calculate commission
  const commission = await calculateCommission(referral.id, invoiceAmountCents);

  // 6. If shouldPay, insert commission_events record
  if (commission.shouldPay) {
    await supabaseAdmin.from('commission_events').insert({
      affiliate_id: referral.affiliate_id,
      referral_id: referral.id,
      event_type: eventType,
      payment_number: newPaymentCount,
      plan_name: planName,
      invoice_amount_cents: invoiceAmountCents,
      commission_amount_cents: commission.amountCents,
      stripe_invoice_id: stripeInvoiceId,
    });
  }

  // 7. If first payment, update referral status to 'active'
  if (newPaymentCount === 1) {
    await supabaseAdmin
      .from('affiliate_referrals')
      .update({ status: 'active' })
      .eq('id', referral.id);
  }
}

// ── processSubscriptionDeletedForAffiliate ───────────────────────

export async function processSubscriptionDeletedForAffiliate(
  companyId: string
): Promise<void> {
  // 1. Look up referral
  const { data: referral } = await supabaseAdmin
    .from('affiliate_referrals')
    .select('id, affiliate_id, payment_count')
    .eq('company_id', companyId)
    .in('status', ['pending', 'trialing', 'active'])
    .maybeSingle();

  if (!referral) return;

  // 2. Set status to 'churned'
  await supabaseAdmin
    .from('affiliate_referrals')
    .update({ status: 'churned' })
    .eq('id', referral.id);

  // 3. Insert churn commission event
  await supabaseAdmin.from('commission_events').insert({
    affiliate_id: referral.affiliate_id,
    referral_id: referral.id,
    event_type: 'churn',
    payment_number: referral.payment_count ?? 0,
    commission_amount_cents: 0,
    invoice_amount_cents: 0,
  });
}
