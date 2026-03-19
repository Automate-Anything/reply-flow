import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

interface UsageMetric {
  used: number;
  included: number;
  overage?: number;
  overage_cost_cents?: number;
}

interface UsageData {
  channels: UsageMetric;
  agents: UsageMetric;
  messages: UsageMetric;
  kb_pages: UsageMetric;
  ai_suggestions: UsageMetric;
}

interface Plan {
  id: string;
  name: string;
  price_monthly_cents: number;
}

interface Subscription {
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  plan: Plan;
}

interface UsageResponse {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: UsageData | null;
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function UsageBar({
  label,
  used,
  included,
  overage = 0,
  overageCostCents = 0,
  unit = '',
}: {
  label: string;
  used: number;
  included: number;
  overage?: number;
  overageCostCents?: number;
  unit?: string;
}) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const hasOverage = overage > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString()}{unit} / {included.toLocaleString()}{unit} included
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', hasOverage ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={hasOverage ? 'flex items-center gap-1 text-destructive' : 'text-muted-foreground'}>
          {hasOverage ? (
            <>
              <AlertTriangle className="h-3 w-3" />
              {overage.toLocaleString()} over limit — {formatCents(overageCostCents)} overage charge
            </>
          ) : (
            `${Math.max(0, included - used).toLocaleString()}${unit} remaining`
          )}
        </span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
    </div>
  );
}

export default function UsageTab() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab');

  useEffect(() => {
    if (activeTab !== 'usage') return;
    setLoading(true);
    api.get('/billing/usage')
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [activeTab]);

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!data?.subscription) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground text-sm">
          You don't have an active plan yet. Select a plan to see your usage.
        </p>
        <Button onClick={() => navigate('/settings?tab=billing')}>View Plans</Button>
      </div>
    );
  }

  const { subscription, usage } = data;
  const u = usage!;

  const totalOverageCents =
    (u.messages.overage_cost_cents ?? 0) + (u.kb_pages.overage_cost_cents ?? 0) + (u.ai_suggestions?.overage_cost_cents ?? 0);

  return (
    <div className="space-y-6">
      {/* Billing period header */}
      <Card>
        <CardContent className="flex items-center justify-between pt-4 pb-4">
          <div>
            <p className="text-sm font-medium">
              Current plan:{' '}
              <span className="font-semibold">{subscription.plan.name}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Billing period: {formatDate(subscription.current_period_start)} –{' '}
              {formatDate(subscription.current_period_end)}
            </p>
          </div>
          <Badge variant={subscription.status === 'active' ? 'default' : 'destructive'}>
            {subscription.status}
          </Badge>
        </CardContent>
      </Card>

      {/* Usage metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Usage This Period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <UsageBar
            label="WhatsApp Channels"
            used={u.channels.used}
            included={u.channels.included}
          />
          <UsageBar
            label="AI Agents"
            used={u.agents.used}
            included={u.agents.included}
          />
          <UsageBar
            label="Messages"
            used={u.messages.used}
            included={u.messages.included}
            overage={u.messages.overage}
            overageCostCents={u.messages.overage_cost_cents}
          />
          <UsageBar
            label="AI Suggestions"
            used={u.ai_suggestions?.used ?? 0}
            included={u.ai_suggestions?.included ?? 0}
            overage={u.ai_suggestions?.overage}
            overageCostCents={u.ai_suggestions?.overage_cost_cents}
          />
          <UsageBar
            label="Knowledge Base Pages"
            used={u.kb_pages.used}
            included={u.kb_pages.included}
            overage={u.kb_pages.overage}
            overageCostCents={u.kb_pages.overage_cost_cents}
            unit=" pages"
          />
        </CardContent>
      </Card>

      {/* Overage summary */}
      {totalOverageCents > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-destructive">Overage charges this period</p>
                {(u.messages.overage ?? 0) > 0 && (
                  <p className="text-muted-foreground">
                    Messages: {u.messages.overage!.toLocaleString()} extra —{' '}
                    {formatCents(u.messages.overage_cost_cents!)}
                  </p>
                )}
                {(u.ai_suggestions?.overage ?? 0) > 0 && (
                  <p className="text-muted-foreground">
                    AI suggestions: {u.ai_suggestions.overage!.toLocaleString()} extra —{' '}
                    {formatCents(u.ai_suggestions.overage_cost_cents!)}
                  </p>
                )}
                {(u.kb_pages.overage ?? 0) > 0 && (
                  <p className="text-muted-foreground">
                    KB pages: {u.kb_pages.overage!.toLocaleString()} extra —{' '}
                    {formatCents(u.kb_pages.overage_cost_cents!)}
                  </p>
                )}
                <p className="font-semibold">
                  Estimated total: {formatCents(totalOverageCents)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KB page definition note */}
      <p className="text-xs text-muted-foreground">
        * 1 KB page = 2,000 tokens of text (~8,000 characters). Usage is calculated from the
        total content stored across all your knowledge bases.
      </p>
    </div>
  );
}
