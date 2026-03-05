import { useState, useEffect } from 'react';
import { Check, Zap, ExternalLink, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
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

export default function BillingTab() {
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);
  const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [changingPlan, setChangingPlan] = useState<PlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
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
          setActivePlanId(data.subscription.plan_id);
          setHasStripeSubscription(!!data.subscription.stripe_subscription_id);
          setCancelAtPeriodEnd(!!data.subscription.cancel_at_period_end);
          setCurrentPeriodEnd(data.subscription.current_period_end ?? null);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchSubscription().finally(() => setLoading(false));
  }, []);

  // Redirect to Stripe Checkout for new subscribers
  const handleCheckout = async () => {
    if (!selected) return;
    setRedirecting(true);
    try {
      const { data } = await api.post('/billing/create-checkout-session', { plan_id: selected });
      window.location.href = data.url;
    } catch {
      toast.error('Failed to start checkout. Please try again.');
      setRedirecting(false);
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

  // Cancel at period end
  const handleCancel = async () => {
    setShowCancelDialog(false);
    setCancelling(true);
    try {
      await api.post('/billing/cancel');
      setCancelAtPeriodEnd(true);
      toast.success('Your subscription will be cancelled at the end of the billing period.');
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

  const pendingPlan = PLANS.find((p) => p.id === selected);

  return (
    <div className="space-y-8">
      {/* Current plan banner */}
      {activePlanId && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Current plan:{' '}
            <span className="font-semibold">
              {PLANS.find((p) => p.id === activePlanId)?.name}
            </span>
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

      {/* Cancellation scheduled banner */}
      {cancelAtPeriodEnd && currentPeriodEnd && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <span>
              Your plan is scheduled to cancel on{' '}
              <span className="font-semibold">{formatDate(currentPeriodEnd)}</span>. You'll keep access until then.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReactivate}
            disabled={reactivating}
          >
            {reactivating ? 'Reactivating…' : 'Reactivate Plan'}
          </Button>
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = activePlanId === plan.id;
          const isStripe = hasStripeSubscription && activePlanId !== null;
          const direction = activePlanId ? getPlanDirection(activePlanId, plan.id) : null;
          const isChanging = changingPlan === plan.id;

          return (
            <Card
              key={plan.id}
              className={cn(
                'relative flex flex-col transition-shadow',
                plan.popular && 'border-primary shadow-md',
                isCurrent && 'ring-2 ring-primary ring-offset-2',
                selected === plan.id && !isCurrent && 'ring-2 ring-primary/50 ring-offset-2'
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
                <CardTitle className="text-lg font-semibold">{plan.name}</CardTitle>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>
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
                ) : isStripe ? (
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

      {/* Checkout CTA — only shown for users without a Stripe subscription */}
      {selected && !hasStripeSubscription && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium">
            Subscribe to{' '}
            <span className="font-semibold">{pendingPlan?.name}</span> — ${pendingPlan?.price}/month
          </p>
          <Button size="sm" onClick={handleCheckout} disabled={redirecting}>
            {redirecting ? 'Redirecting…' : 'Confirm & Subscribe'}
          </Button>
        </div>
      )}

      {/* Cancel plan option */}
      {hasStripeSubscription && !cancelAtPeriodEnd && (
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
            <AlertDialogTitle>Cancel your plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will remain active until{' '}
              {currentPeriodEnd ? formatDate(currentPeriodEnd) : 'the end of your billing period'}.
              After that, you'll lose access to AI agents, channels, and other paid features.
              You can reactivate any time before then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Plan</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Cancel Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
