import { useState, useEffect } from 'react';
import { Check, Zap, ExternalLink, ArrowUp, ArrowDown, AlertTriangle, Clock, Plus, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useSearchParams } from 'react-router-dom';

type PlanId = 'starter' | 'pro' | 'scale';
type AddonId = 'extra_channel' | 'extra_agent';

interface AddonProduct {
  id: AddonId;
  name: string;
  description: string;
  price_monthly_cents: number;
}

interface PurchasedAddon {
  addon_id: AddonId;
  quantity: number;
}

interface Plan {
  id: PlanId;
  name: string;
  price: number;
  channels: number;
  agents: number;
  knowledgeBases: number;
  kbPages: number;
  kbTokens: string;
  messages: number;
  overageMessage: string;
  overagePage: string;
  overagePageBulk: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    channels: 1,
    agents: 1,
    knowledgeBases: 1,
    kbPages: 5,
    kbTokens: '10,000',
    messages: 500,
    overageMessage: '$0.03',
    overagePage: '$0.05',
    overagePageBulk: '$5 / 100 pages',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 59,
    channels: 2,
    agents: 3,
    knowledgeBases: 5,
    kbPages: 50,
    kbTokens: '100,000',
    messages: 1000,
    overageMessage: '$0.02',
    overagePage: '$0.04',
    overagePageBulk: '$4 / 100 pages',
    popular: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    price: 99,
    channels: 3,
    agents: 5,
    knowledgeBases: 10,
    kbPages: 200,
    kbTokens: '400,000',
    messages: 2000,
    overageMessage: '$0.015',
    overagePage: '$0.03',
    overagePageBulk: '$3 / 100 pages',
  },
];

const PLAN_ORDER: PlanId[] = ['starter', 'pro', 'scale'];

function getPlanDirection(currentId: PlanId, targetId: PlanId): 'upgrade' | 'downgrade' | 'current' {
  const currentIdx = PLAN_ORDER.indexOf(currentId);
  const targetIdx = PLAN_ORDER.indexOf(targetId);
  if (currentIdx === targetIdx) return 'current';
  return targetIdx > currentIdx ? 'upgrade' : 'downgrade';
}

function PlanFeature({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{label}</span>
    </li>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function daysRemaining(isoDate: string): number {
  const now = new Date();
  const end = new Date(isoDate);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function BillingTab() {
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [skippingTrial, setSkippingTrial] = useState(false);
  const [changingPlan, setChangingPlan] = useState<PlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [addonProducts, setAddonProducts] = useState<AddonProduct[]>([]);
  const [purchasedAddons, setPurchasedAddons] = useState<PurchasedAddon[]>([]);
  const [addonLoading, setAddonLoading] = useState<Partial<Record<AddonId, 'adding' | 'removing'>>>({});
  const [pendingQty, setPendingQty] = useState<Partial<Record<AddonId, number>>>({});
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast.success('Subscription activated! Welcome aboard.');
      setSearchParams((prev) => { prev.delete('success'); return prev; }, { replace: true });
    }
  }, []);

  const fetchSubscription = () => {
    return api.get('/billing/subscription')
      .then(({ data }) => {
        if (data.subscription) {
          const sub = data.subscription;
          setActivePlanId(sub.plan_id as PlanId);
          setSubscriptionStatus(sub.status);
          setHasStripeSubscription(!!sub.stripe_subscription_id);
          setCancelAtPeriodEnd(!!sub.cancel_at_period_end);
          setCurrentPeriodEnd(sub.current_period_end ?? null);
          setTrialEndsAt(sub.trial_ends_at ?? null);
        } else {
          setSubscriptionStatus(null);
          setActivePlanId(null);
        }
      })
      .catch(() => {});
  };

  const fetchAddons = () => {
    return api.get('/billing/addons')
      .then(({ data }) => {
        setAddonProducts(data.available ?? []);
        setPurchasedAddons(data.purchased ?? []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    Promise.all([fetchSubscription(), fetchAddons()]).finally(() => setLoading(false));
  }, []);

  // Keep pendingQty in sync with purchased addons (on load and after a successful update)
  useEffect(() => {
    const map: Partial<Record<AddonId, number>> = {};
    purchasedAddons.forEach((a) => { map[a.addon_id] = a.quantity; });
    setPendingQty(map);
  }, [purchasedAddons]);

  const handleAddonUpdate = async (addonId: AddonId, quantity: number) => {
    setAddonLoading((prev) => ({ ...prev, [addonId]: 'adding' }));
    try {
      await api.post('/billing/addons/update', { addon_id: addonId, quantity });
      await fetchAddons();
      toast.success('Add-on updated.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update add-on. Please try again.');
    } finally {
      setAddonLoading((prev) => { const next = { ...prev }; delete next[addonId]; return next; });
    }
  };

  // Redirect to Stripe Checkout — with_trial: true adds a 7-day free trial period
  const handleCheckout = async (planId: PlanId, withTrial = false) => {
    setRedirecting(true);
    try {
      const { data } = await api.post('/billing/create-checkout-session', {
        plan_id: planId,
        with_trial: withTrial,
      });
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to start checkout. Please try again.');
      setRedirecting(false);
    }
  };

  // End the trial immediately — first charge fires now, full plan limits apply
  const handleSkipTrial = async () => {
    setSkippingTrial(true);
    try {
      await api.post('/billing/skip-trial');
      toast.success('Trial ended. Your full plan is now active.');
      await fetchSubscription();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to skip trial. Please try again.');
    } finally {
      setSkippingTrial(false);
    }
  };

  // Redirect to Stripe Customer Portal (for payment method management)
  const handleManageSubscription = async () => {
    setRedirecting(true);
    try {
      const { data } = await api.post('/billing/portal');
      window.location.href = data.url;
    } catch {
      toast.error('Failed to open billing portal. Please try again.');
      setRedirecting(false);
    }
  };

  // Upgrade or downgrade in-app
  const handleChangePlan = async (planId: PlanId) => {
    setChangingPlan(planId);
    try {
      await api.post('/billing/change-plan', { plan_id: planId });
      const direction = activePlanId ? getPlanDirection(activePlanId, planId) : 'upgrade';
      toast.success(`Plan ${direction === 'upgrade' ? 'upgraded' : 'downgraded'} successfully.`);
      await fetchSubscription();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to change plan. Please try again.');
    } finally {
      setChangingPlan(null);
    }
  };

  // Cancel at period end (if trialing, cancels at trial end — no charge)
  const handleCancel = async () => {
    setShowCancelDialog(false);
    setCancelling(true);
    try {
      await api.post('/billing/cancel');
      setCancelAtPeriodEnd(true);
      toast.success(
        isTrialing
          ? 'Trial cancelled. You will not be charged.'
          : 'Your subscription will be cancelled at the end of the billing period.'
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to cancel. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  // Reactivate (undo scheduled cancellation)
  const handleReactivate = async () => {
    setReactivating(true);
    try {
      await api.post('/billing/reactivate');
      setCancelAtPeriodEnd(false);
      toast.success('Your subscription has been reactivated.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to reactivate. Please try again.');
    } finally {
      setReactivating(false);
    }
  };


  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const isTrialing = subscriptionStatus === 'trialing';
  // A user who had any subscription (even cancelled) has used their trial eligibility
  const hasHadSubscription = subscriptionStatus !== null;
  const hasNoSubscription = subscriptionStatus === null;
  const pendingPlan = PLANS.find((p) => p.id === selected);
  const trialDaysLeft = trialEndsAt ? daysRemaining(trialEndsAt) : 0;
  const activePlanName = PLANS.find((p) => p.id === activePlanId)?.name;

  return (
    <div className="space-y-8">
      {/* Trial banner */}
      {isTrialing && trialEndsAt && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="text-sm">
                <p className="font-semibold text-blue-900 dark:text-blue-100">
                  {trialDaysLeft > 0
                    ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial`
                    : 'Your free trial ends today'}
                  {activePlanName && (
                    <span className="font-normal text-blue-700 dark:text-blue-300"> — {activePlanName} plan</span>
                  )}
                </p>
                <p className="mt-0.5 text-blue-700 dark:text-blue-300">
                  Trial limits: 1 WhatsApp channel · 1 AI agent · 100 messages · 3 KB pages.
                  {trialEndsAt && (
                    <> Your {activePlanName} plan starts automatically on <strong>{formatDate(trialEndsAt)}</strong>.</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelling || cancelAtPeriodEnd}
                className="border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300"
              >
                {cancelAtPeriodEnd ? 'Cancellation Scheduled' : 'Cancel Trial'}
              </Button>
              <Button
                size="sm"
                onClick={handleSkipTrial}
                disabled={skippingTrial || cancelAtPeriodEnd}
              >
                {skippingTrial ? 'Activating…' : 'Skip Trial & Start Now'}
              </Button>
            </div>
          </div>
          {cancelAtPeriodEnd && (
            <div className="mt-3 flex items-center justify-between border-t border-blue-200 pt-3 text-sm dark:border-blue-800">
              <span className="text-blue-700 dark:text-blue-300">
                Trial will end on <strong>{trialEndsAt ? formatDate(trialEndsAt) : '—'}</strong>. You will not be charged.
              </span>
              <Button size="sm" variant="ghost" onClick={handleReactivate} disabled={reactivating}
                className="text-blue-700 hover:text-blue-900 dark:text-blue-300">
                {reactivating ? 'Reactivating…' : 'Undo Cancellation'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Current plan banner (active paid subscribers, not on trial) */}
      {activePlanId && !isTrialing && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Current plan: <span className="font-semibold">{activePlanName}</span>
          </span>
          {hasStripeSubscription && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManageSubscription}
              disabled={redirecting}
              className="gap-1.5 text-muted-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Manage Payment Method
            </Button>
          )}
        </div>
      )}

      {/* Cancellation scheduled banner (paid subscribers only) */}
      {cancelAtPeriodEnd && !isTrialing && currentPeriodEnd && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <span>
              Your plan is scheduled to cancel on{' '}
              <span className="font-semibold">{formatDate(currentPeriodEnd)}</span>. You'll keep access until then.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={handleReactivate} disabled={reactivating}>
            {reactivating ? 'Reactivating…' : 'Reactivate Plan'}
          </Button>
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = !isTrialing && activePlanId === plan.id;
          const isTrialPlan = isTrialing && activePlanId === plan.id;
          const isStripeActive = hasStripeSubscription && !isTrialing && activePlanId !== null;
          const direction = activePlanId && !isTrialing ? getPlanDirection(activePlanId, plan.id) : null;
          const isChanging = changingPlan === plan.id;

          return (
            <Card
              key={plan.id}
              className={cn(
                'relative flex flex-col transition-shadow',
                plan.popular && 'border-primary shadow-md',
                isCurrent && 'ring-2 ring-primary ring-offset-2',
                isTrialPlan && 'ring-2 ring-blue-400 ring-offset-2',
                selected === plan.id && !isCurrent && !isTrialPlan && 'ring-2 ring-primary/50 ring-offset-2'
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-0 right-0 flex justify-center">
                  <Badge className="gap-1 px-3 py-0.5 text-xs">
                    <Zap className="h-3 w-3" /> Most Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-4 pt-6">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">{plan.name}</CardTitle>
                  {isTrialPlan && (
                    <Badge variant="secondary" className="text-xs">
                      In Trial
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>
                {hasNoSubscription && (
                  <p className="text-xs text-muted-foreground">Includes 7-day free trial</p>
                )}
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-6">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Included
                  </p>
                  <ul className="space-y-2">
                    <PlanFeature label={`${plan.channels} WhatsApp channel${plan.channels > 1 ? 's' : ''}`} />
                    <PlanFeature label={`${plan.agents} AI agent${plan.agents > 1 ? 's' : ''}`} />
                    <PlanFeature label={`Up to ${plan.knowledgeBases} knowledge base${plan.knowledgeBases > 1 ? 's' : ''}`} />
                  </ul>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Knowledge base capacity</p>
                    <p className="mt-0.5 text-sm font-semibold">{plan.kbPages} pages included</p>
                    <p className="text-xs text-muted-foreground">{plan.kbTokens} tokens</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Messages included</p>
                    <p className="mt-0.5 text-sm font-semibold">
                      {plan.messages.toLocaleString()} messages / month
                    </p>
                  </div>
                </div>

                {/* Plan action button */}
                {isCurrent ? (
                  <Button className="mt-auto w-full" variant="outline" disabled>
                    Current Plan
                  </Button>
                ) : isTrialPlan ? (
                  <Button className="mt-auto w-full" variant="outline" disabled>
                    Currently Trialing
                  </Button>
                ) : isTrialing ? (
                  // On a trial for a different plan — offer switching
                  <Button
                    className="mt-auto w-full"
                    variant="outline"
                    onClick={() => handleSkipTrial()}
                    disabled={skippingTrial}
                  >
                    Switch to {plan.name}
                  </Button>
                ) : isStripeActive ? (
                  <Button
                    className="mt-auto w-full gap-1.5"
                    variant={direction === 'upgrade' ? 'default' : 'outline'}
                    disabled={isChanging || changingPlan !== null}
                    onClick={() => handleChangePlan(plan.id)}
                  >
                    {isChanging ? (
                      'Switching…'
                    ) : direction === 'upgrade' ? (
                      <><ArrowUp className="h-4 w-4" /> Upgrade</>
                    ) : (
                      <><ArrowDown className="h-4 w-4" /> Downgrade</>
                    )}
                  </Button>
                ) : (
                  <Button
                    className="mt-auto w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                    onClick={() => setSelected(plan.id)}
                  >
                    {selected === plan.id ? 'Selected' : 'Select Plan'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Overage Pricing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Overage Pricing</CardTitle>
          <p className="text-sm text-muted-foreground">
            Usage beyond your plan limits is billed at the rates below.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Plan</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Extra Message</th>
                  <th className="pb-2 text-left font-medium text-muted-foreground">Extra KB Page</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PLANS.map((plan) => (
                  <tr key={plan.id}>
                    <td className="py-3 font-medium">{plan.name}</td>
                    <td className="py-3">
                      <span className="font-semibold">{plan.overageMessage}</span>
                      <span className="text-muted-foreground"> per message</span>
                    </td>
                    <td className="py-3">
                      <span className="font-semibold">{plan.overagePage}</span>
                      <span className="text-muted-foreground"> per page</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({plan.overagePageBulk})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add-ons — only shown to active (non-trial) Stripe subscribers */}
      {hasStripeSubscription && !isTrialing && subscriptionStatus === 'active' && addonProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Add-ons</CardTitle>
            <p className="text-sm text-muted-foreground">
              Expand your plan with additional channels or agents. Billed monthly, prorated from purchase date.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {addonProducts.map((product) => {
              const purchased = purchasedAddons.find((p) => p.addon_id === product.id);
              const currentQty = purchased?.quantity ?? 0;
              const pendingQ = pendingQty[product.id] ?? 0;
              const hasChanges = pendingQ !== currentQty;
              const state = addonLoading[product.id];
              const busy = !!state;

              return (
                <div key={product.id} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.description}</p>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-muted-foreground">
                    ${(product.price_monthly_cents / 100).toFixed(0)}/mo each
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={busy || pendingQ === 0}
                      onClick={() => setPendingQty((p) => ({ ...p, [product.id]: Math.max(0, (p[product.id] ?? currentQty) - 1) }))}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-5 text-center text-sm font-semibold tabular-nums">
                      {busy ? '…' : pendingQ}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      disabled={busy}
                      onClick={() => setPendingQty((p) => ({ ...p, [product.id]: (p[product.id] ?? currentQty) + 1 }))}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {hasChanges && (
                      <Button
                        size="sm"
                        className="ml-1"
                        disabled={busy}
                        onClick={() => handleAddonUpdate(product.id, pendingQ)}
                      >
                        {busy ? 'Saving…' : 'Confirm'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Checkout CTA — shown when a plan is selected and user has no existing subscription */}
      {selected && !isTrialing && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 space-y-3">
          <p className="text-sm font-medium">
            <span className="font-semibold">{pendingPlan?.name}</span> — ${pendingPlan?.price}/month
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {hasNoSubscription && (
              <Button
                className="flex-1"
                onClick={() => handleCheckout(selected, true)}
                disabled={redirecting}
              >
                {redirecting ? 'Redirecting…' : 'Start 7-Day Free Trial'}
              </Button>
            )}
            <Button
              variant={hasNoSubscription ? 'outline' : 'default'}
              className="flex-1"
              onClick={() => handleCheckout(selected, false)}
              disabled={redirecting}
            >
              {redirecting ? 'Redirecting…' : hasHadSubscription ? 'Subscribe Now' : 'Subscribe Without Trial'}
            </Button>
          </div>
          {hasNoSubscription && (
            <p className="text-xs text-muted-foreground">
              Free trial: 1 channel · 1 agent · 100 messages · 3 KB pages for 7 days. Credit card required — you won't be charged until the trial ends.
            </p>
          )}
        </div>
      )}

      {/* Cancel plan option (paid subscribers only) */}
      {hasStripeSubscription && !isTrialing && !cancelAtPeriodEnd && (
        <div className="text-center">
          <button
            onClick={() => setShowCancelDialog(true)}
            disabled={cancelling}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel Plan'}
          </button>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isTrialing ? 'Cancel your free trial?' : 'Cancel your plan?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isTrialing ? (
                <>
                  Your trial will be cancelled and you will <strong>not be charged</strong>.
                  You'll keep access to trial features until{' '}
                  {trialEndsAt ? formatDate(trialEndsAt) : 'the trial ends'}.
                  You can reactivate before then if you change your mind.
                </>
              ) : (
                <>
                  Your subscription will remain active until{' '}
                  {currentPeriodEnd ? formatDate(currentPeriodEnd) : 'the end of your billing period'}.
                  After that, you'll lose access to AI agents, channels, and other paid features.
                  You can reactivate any time before then.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isTrialing ? 'Keep Trial' : 'Keep Plan'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isTrialing ? 'Yes, Cancel Trial' : 'Yes, Cancel Plan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
