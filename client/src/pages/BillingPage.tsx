import { useState, useEffect, useRef } from 'react';
import { CreditCard, Check, Zap, ExternalLink, Wallet, Lock, Tag, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';

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
  aiSuggestions: number;
  overageMessage: string;
  overagePage: string;
  overagePageBulk: string;
  overageSuggestion: string;
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
    aiSuggestions: 50,
    overageMessage: '$0.035',
    overagePage: '$0.05',
    overagePageBulk: '$5 / 100 pages',
    overageSuggestion: '$0.025',
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
    aiSuggestions: 150,
    overageMessage: '$0.03',
    overagePage: '$0.04',
    overagePageBulk: '$4 / 100 pages',
    overageSuggestion: '$0.02',
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
    aiSuggestions: 400,
    overageMessage: '$0.025',
    overagePage: '$0.03',
    overagePageBulk: '$3 / 100 pages',
    overageSuggestion: '$0.015',
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

interface BalanceData {
  balance_cents: number;
  auto_topup_enabled: boolean;
  auto_topup_threshold_cents: number | null;
  auto_topup_amount_cents: number | null;
}

const TOPUP_PRESETS = [
  { label: '$10', cents: 1000 },
  { label: '$25', cents: 2500 },
  { label: '$50', cents: 5000 },
  { label: '$100', cents: 10000 },
];

export default function BillingPage() {
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);
  const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useSession();
  const canManage = hasPermission('billing', 'manage');

  // Coupon code state
  const [couponInput, setCouponInput] = useState('');
  const [couponState, setCouponState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [couponDescription, setCouponDescription] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const couponDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Balance & auto top-up state
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [topupPreset, setTopupPreset] = useState<number>(2500);
  const [topupLoading, setTopupLoading] = useState(false);
  const [autoTopupEnabled, setAutoTopupEnabled] = useState(false);
  const [autoTopupThreshold, setAutoTopupThreshold] = useState('500'); // cents
  const [autoTopupAmount, setAutoTopupAmount] = useState('1000'); // cents
  const [savingAutoTopup, setSavingAutoTopup] = useState(false);

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast.success('Subscription activated! Welcome aboard.');
      setSearchParams((prev) => { prev.delete('success'); return prev; }, { replace: true });
    }
    if (searchParams.get('topup') === 'success') {
      toast.success('Balance topped up successfully!');
      setSearchParams((prev) => { prev.delete('topup'); return prev; }, { replace: true });
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
      .catch(() => {})
      .finally(() => setLoading(false));

    api.get('/billing/balance')
      .then(({ data }) => {
        setBalanceData(data);
        setAutoTopupEnabled(data.auto_topup_enabled ?? false);
        if (data.auto_topup_threshold_cents) {
          setAutoTopupThreshold(String(data.auto_topup_threshold_cents));
        }
        if (data.auto_topup_amount_cents) {
          setAutoTopupAmount(String(data.auto_topup_amount_cents));
        }
      })
      .catch(() => {});
  }, []);

  const handleCouponChange = (value: string) => {
    setCouponInput(value);
    setAppliedCoupon(null);
    setCouponDescription(null);

    if (couponDebounceRef.current) clearTimeout(couponDebounceRef.current);

    if (!value.trim()) {
      setCouponState('idle');
      return;
    }

    setCouponState('checking');
    couponDebounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/billing/validate-coupon/${encodeURIComponent(value.trim().toUpperCase())}`);
        if (data.valid) {
          setCouponState('valid');
          setCouponDescription(data.description ?? null);
          setAppliedCoupon(value.trim().toUpperCase());
        } else {
          setCouponState('invalid');
        }
      } catch {
        setCouponState('invalid');
      }
    }, 500);
  };

  const handleRemoveCoupon = () => {
    setCouponInput('');
    setCouponState('idle');
    setCouponDescription(null);
    setAppliedCoupon(null);
  };

  const handleCheckout = async () => {
    if (!selected) return;
    setRedirecting(true);
    try {
      const { data } = await api.post('/billing/create-checkout-session', {
        plan_id: selected,
        ...(appliedCoupon ? { coupon_code: appliedCoupon } : {}),
      });
      window.location.href = data.url;
    } catch {
      toast.error('Failed to start checkout. Please try again.');
      setRedirecting(false);
    }
  };

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

  const handleTopup = async () => {
    setTopupLoading(true);
    try {
      const { data } = await api.post('/billing/topup', { amount_cents: topupPreset });
      window.location.href = data.url;
    } catch {
      toast.error('Failed to start top-up. Please try again.');
      setTopupLoading(false);
    }
  };

  const handleSaveAutoTopup = async () => {
    setSavingAutoTopup(true);
    try {
      await api.post('/billing/configure-auto-topup', {
        enabled: autoTopupEnabled,
        threshold_cents: autoTopupEnabled ? parseInt(autoTopupThreshold, 10) : undefined,
        amount_cents: autoTopupEnabled ? parseInt(autoTopupAmount, 10) : undefined,
      });
      toast.success('Auto top-up settings saved.');
    } catch {
      toast.error('Failed to save auto top-up settings.');
    } finally {
      setSavingAutoTopup(false);
    }
  };

  const pendingPlan = PLANS.find((p) => p.id === selected);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Billing & Plans</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Choose the plan that fits your business.
            </p>
          </div>
        </div>
        {hasStripeSubscription && canManage && (
          <Button
            variant="outline"
            onClick={handleManageSubscription}
            disabled={redirecting}
            className="gap-1.5"
          >
            <ExternalLink className="h-4 w-4" />
            Manage Subscription
          </Button>
        )}
      </div>

      {loading && (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
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
                  <PlanFeature
                    label={`${plan.channels} WhatsApp channel${plan.channels > 1 ? 's' : ''}`}
                  />
                  <PlanFeature
                    label={`${plan.agents} AI agent${plan.agents > 1 ? 's' : ''}`}
                  />
                  <PlanFeature
                    label={`Up to ${plan.knowledgeBases} knowledge base${plan.knowledgeBases > 1 ? 's' : ''}`}
                  />
                </ul>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Knowledge base capacity</p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {plan.kbPages} pages included
                  </p>
                  <p className="text-xs text-muted-foreground">{plan.kbTokens} tokens</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Messages included</p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {plan.messages.toLocaleString()} messages / month
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">AI suggestions included</p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {plan.aiSuggestions} AI suggestions / month
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {plan.overageSuggestion} per extra suggestion
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Features
                </p>
                <ul className="space-y-2">
                  <PlanFeature label="Auto classification (labels, priority, tags)" />
                </ul>
              </div>

              <Button
                className="mt-auto w-full"
                variant={plan.popular ? 'default' : 'outline'}
                disabled={!canManage || activePlanId === plan.id || (hasStripeSubscription && activePlanId !== null)}
                onClick={() => setSelected(plan.id)}
              >
                {!canManage ? (
                  <><Lock className="mr-1.5 h-3.5 w-3.5" /> Owner / Admin Only</>
                ) : activePlanId === plan.id
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
                  <th className="pb-2 text-left font-medium text-muted-foreground">Extra AI Suggestion</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PLANS.map((plan) => (
                  <tr key={plan.id} className="group">
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
                    <td className="py-3">
                      <span className="font-semibold">{plan.overageSuggestion}</span>
                      <span className="text-muted-foreground"> per suggestion</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Checkout CTA */}
      {selected && !hasStripeSubscription && canManage && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Subscribe to{' '}
              <span className="font-semibold">{pendingPlan?.name}</span>{' '}
              — ${pendingPlan?.price}/month
            </p>
            <Button size="sm" onClick={handleCheckout} disabled={redirecting || couponState === 'checking'}>
              {redirecting ? 'Redirecting…' : 'Confirm & Subscribe'}
            </Button>
          </div>

          {/* Coupon code input */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Tag className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 pr-8 text-xs uppercase placeholder:normal-case placeholder:text-muted-foreground"
                placeholder="Coupon code (optional)"
                value={couponInput}
                onChange={(e) => handleCouponChange(e.target.value)}
                disabled={redirecting}
              />
              {couponInput && (
                <button
                  onClick={handleRemoveCoupon}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {couponState === 'checking' && (
              <span className="text-xs text-muted-foreground">Checking…</span>
            )}
            {couponState === 'valid' && (
              <span className="text-xs font-medium text-green-600">
                <Check className="mr-1 inline h-3.5 w-3.5" />
                {couponDescription ?? 'Discount applied'}
              </span>
            )}
            {couponState === 'invalid' && (
              <span className="text-xs text-destructive">Invalid code</span>
            )}
          </div>
        </div>
      )}

      {/* Balance & Top-up */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">AI Message Balance</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Keep a credit balance to cover messages beyond your plan's monthly limit. If your
            balance runs out, your AI agent will pause until you add more credits.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current balance */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current Balance
            </p>
            <p className="mt-1 text-2xl font-bold">
              ${((balanceData?.balance_cents ?? 0) / 100).toFixed(2)}
            </p>
          </div>

          {/* Manual top-up */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Add Balance</p>
            <div className="flex flex-wrap gap-2">
              {TOPUP_PRESETS.map((preset) => (
                <button
                  key={preset.cents}
                  onClick={() => setTopupPreset(preset.cents)}
                  className={cn(
                    'rounded-md border px-4 py-1.5 text-sm font-medium transition-colors',
                    topupPreset === preset.cents
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:border-primary/50 hover:bg-muted'
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <Button
              onClick={handleTopup}
              disabled={topupLoading || !hasStripeSubscription}
              size="sm"
            >
              {topupLoading
                ? 'Redirecting…'
                : `Add $${(topupPreset / 100).toFixed(0)} to Balance`}
            </Button>
            {!hasStripeSubscription && (
              <p className="text-xs text-muted-foreground">
                You need an active subscription to top up your balance.
              </p>
            )}
          </div>

          {/* Auto top-up */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto Top-up</p>
                <p className="text-xs text-muted-foreground">
                  Automatically recharge when your balance runs low.
                </p>
              </div>
              <Switch
                checked={autoTopupEnabled}
                onCheckedChange={setAutoTopupEnabled}
                disabled={!hasStripeSubscription}
              />
            </div>

            {autoTopupEnabled && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="topup-threshold" className="text-xs">
                      Top up when balance falls below
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        id="topup-threshold"
                        type="number"
                        min="1"
                        step="1"
                        className="pl-6"
                        value={String(parseInt(autoTopupThreshold, 10) / 100 || '')}
                        onChange={(e) =>
                          setAutoTopupThreshold(
                            String(Math.round(parseFloat(e.target.value || '0') * 100))
                          )
                        }
                        placeholder="5.00"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="topup-amount" className="text-xs">
                      Charge amount
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        id="topup-amount"
                        type="number"
                        min="5"
                        step="1"
                        className="pl-6"
                        value={String(parseInt(autoTopupAmount, 10) / 100 || '')}
                        onChange={(e) =>
                          setAutoTopupAmount(
                            String(Math.round(parseFloat(e.target.value || '0') * 100))
                          )
                        }
                        placeholder="10.00"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Uses your saved payment method.{' '}
                  <button
                    onClick={handleManageSubscription}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Manage payment method →
                  </button>
                </p>
              </div>
            )}

            {hasStripeSubscription && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveAutoTopup}
                disabled={savingAutoTopup}
              >
                {savingAutoTopup ? 'Saving…' : 'Save Auto Top-up Settings'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
