import { useState, useEffect } from 'react';
import { Check, Zap, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

function PlanFeature({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{label}</span>
    </li>
  );
}

export default function BillingTab() {
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);
  const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    // Show success toast if returning from Stripe Checkout
    if (searchParams.get('success') === 'true') {
      toast.success('Subscription activated! Welcome aboard.');
      setSearchParams((prev) => { prev.delete('success'); return prev; }, { replace: true });
    }
  }, []);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(({ data }) => {
        if (data.subscription) {
          setActivePlanId(data.subscription.plan_id);
          setHasStripeSubscription(!!data.subscription.stripe_subscription_id);
        }
      })
      .catch(() => {
        // No subscription yet — that's fine
      })
      .finally(() => setLoading(false));
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

  // Redirect to Stripe Customer Portal for existing subscribers
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

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const pendingPlan = PLANS.find((p) => p.id === selected);

  return (
    <div className="space-y-8">
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
              variant="outline"
              size="sm"
              onClick={handleManageSubscription}
              disabled={redirecting}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Manage Subscription
            </Button>
          )}
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={cn(
              'relative flex flex-col transition-shadow',
              plan.popular && 'border-primary shadow-md',
              activePlanId === plan.id && 'ring-2 ring-primary ring-offset-2',
              selected === plan.id && activePlanId !== plan.id && 'ring-2 ring-primary/50 ring-offset-2'
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

              <Button
                className="mt-auto w-full"
                variant={plan.popular ? 'default' : 'outline'}
                disabled={activePlanId === plan.id || (hasStripeSubscription && activePlanId !== null)}
                onClick={() => setSelected(plan.id)}
              >
                {activePlanId === plan.id
                  ? 'Current Plan'
                  : hasStripeSubscription
                  ? 'Manage via Portal'
                  : selected === plan.id
                  ? 'Selected'
                  : 'Select Plan'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Hint for existing subscribers */}
      {hasStripeSubscription && (
        <p className="text-center text-sm text-muted-foreground">
          To change your plan, click <strong>Manage Subscription</strong> above.
        </p>
      )}

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
    </div>
  );
}
