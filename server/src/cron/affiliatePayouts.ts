import cron from 'node-cron';
import Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export async function runPayouts(): Promise<{ processed: number; skipped: number; failed: number }> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  // 1. Fetch payout_settings for min_payout_cents
  const { data: settings } = await supabaseAdmin
    .from('payout_settings')
    .select('min_payout_cents')
    .single();

  const minPayoutCents = settings?.min_payout_cents ?? 1000; // default $10

  // 2. Calculate period: previous month
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of prev month
  const periodStartStr = periodStart.toISOString().split('T')[0];
  const periodEndStr = periodEnd.toISOString().split('T')[0];

  // 3. Find approved affiliates with bank account connected
  const { data: affiliates } = await supabaseAdmin
    .from('affiliates')
    .select('id, stripe_connect_account_id')
    .eq('approval_status', 'approved')
    .eq('bank_account_added', true);

  if (!affiliates || affiliates.length === 0) {
    return { processed, skipped, failed };
  }

  for (const affiliate of affiliates) {
    try {
      // a. Sum unpaid commission_events
      const { data: unpaidEvents } = await supabaseAdmin
        .from('commission_events')
        .select('id, commission_amount_cents')
        .eq('affiliate_id', affiliate.id)
        .is('payout_id', null);

      const totalCents = (unpaidEvents || []).reduce(
        (sum, e) => sum + (e.commission_amount_cents || 0),
        0
      );

      // b. Skip if below minimum
      if (totalCents < minPayoutCents) {
        skipped++;
        continue;
      }

      // c. Check for existing payout with same period (idempotency)
      const { data: existingPayout } = await supabaseAdmin
        .from('affiliate_payouts')
        .select('id')
        .eq('affiliate_id', affiliate.id)
        .eq('period_start', periodStartStr)
        .eq('period_end', periodEndStr)
        .maybeSingle();

      if (existingPayout) {
        skipped++;
        continue;
      }

      // d. Create affiliate_payouts record (status = 'pending')
      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('affiliate_payouts')
        .insert({
          affiliate_id: affiliate.id,
          period_start: periodStartStr,
          period_end: periodEndStr,
          amount_cents: totalCents,
          status: 'pending',
        })
        .select('id')
        .single();

      if (payoutError || !payout) {
        console.error(`Failed to create payout for affiliate ${affiliate.id}:`, payoutError);
        failed++;
        continue;
      }

      // e. Link commission_events to this payout
      const eventIds = (unpaidEvents || []).map((e) => e.id);
      if (eventIds.length > 0) {
        await supabaseAdmin
          .from('commission_events')
          .update({ payout_id: payout.id })
          .in('id', eventIds);
      }

      // f. Transfer via Stripe if configured
      if (stripe && affiliate.stripe_connect_account_id) {
        try {
          const transfer = await stripe.transfers.create({
            amount: totalCents,
            currency: 'usd',
            destination: affiliate.stripe_connect_account_id,
          });

          await supabaseAdmin
            .from('affiliate_payouts')
            .update({
              status: 'paid',
              stripe_transfer_id: transfer.id,
              paid_at: new Date().toISOString(),
            })
            .eq('id', payout.id);

          processed++;
        } catch (stripeErr) {
          console.error(`Stripe transfer failed for affiliate ${affiliate.id}:`, stripeErr);
          await supabaseAdmin
            .from('affiliate_payouts')
            .update({ status: 'failed' })
            .eq('id', payout.id);
          failed++;
        }
      } else {
        // No Stripe configured — mark as pending for manual processing
        processed++;
      }
    } catch (err) {
      console.error(`Payout error for affiliate ${affiliate.id}:`, err);
      failed++;
    }
  }

  return { processed, skipped, failed };
}

export function startPayoutScheduler(): void {
  // Run daily at midnight UTC — only execute payouts on the configured day of month
  cron.schedule('0 0 * * *', async () => {
    try {
      const { data: settings } = await supabaseAdmin
        .from('payout_settings')
        .select('payout_day_of_month')
        .single();

      const today = new Date().getUTCDate();
      if (settings && today === settings.payout_day_of_month) {
        console.log('Running scheduled affiliate payouts...');
        const result = await runPayouts();
        console.log('Payout run complete:', result);
      }
    } catch (err) {
      console.error('Payout scheduler error:', err);
    }
  });
  console.log('Affiliate payout scheduler started');
}
