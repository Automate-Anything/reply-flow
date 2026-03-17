import { useState, useMemo } from 'react';
import { TrendingUp, Users, DollarSign, Calendar, Copy, Check, BarChart3, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { formatCents } from '../lib/utils';
import type { Stats, Balance, EarningsMonth, FunnelData } from '../hooks/usePortalData';
import type { ReactNode } from 'react';

interface DashboardTabProps {
  stats: Stats | null;
  balance: Balance | null;
  earningsHistory: EarningsMonth[];
  funnel: FunnelData | null;
  affiliateLink: string;
  dataLoading: boolean;
}

interface StatCardDef {
  label: string;
  value: string;
  icon: ReactNode;
}

function DashboardTab({ stats, balance, earningsHistory, funnel, affiliateLink, dataLoading }: DashboardTabProps) {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(affiliateLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chartData = useMemo(() => {
    return earningsHistory.map((m) => ({
      month: formatMonthLabel(m.month),
      amount: m.amountCents / 100,
    }));
  }, [earningsHistory]);

  if (dataLoading && !stats) {
    return (
      <div className="space-y-6">
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6">
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i}>
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-[hsl(var(--card))] rounded-lg shadow p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  const statCards: StatCardDef[] = stats
    ? [
        { label: 'Total Referrals', value: stats.totalReferrals.toString(), icon: <TrendingUp className="h-5 w-5" /> },
        { label: 'Active Companies', value: stats.activeCompanies.toString(), icon: <Users className="h-5 w-5" /> },
        { label: 'This Month', value: formatCents(stats.thisMonthCommission), icon: <Calendar className="h-5 w-5" /> },
        { label: 'Conversion Rate', value: stats.conversionRate !== undefined ? `${stats.conversionRate}%` : `${stats.activeCompanies && stats.totalReferrals ? Math.round((stats.activeCompanies / stats.totalReferrals) * 100) : 0}%`, icon: <BarChart3 className="h-5 w-5" /> },
      ]
    : [];

  const funnelSteps = funnel
    ? [
        { label: 'Clicks', value: funnel.clicks, rate: null },
        { label: 'Signups', value: funnel.signups, rate: funnel.clickToSignupRate },
        { label: 'Trials', value: funnel.trials, rate: funnel.signups > 0 ? Math.round((funnel.trials / funnel.signups) * 10000) / 100 : 0 },
        { label: 'Active', value: funnel.active, rate: funnel.signupToActiveRate },
      ]
    : [];

  const funnelMax = funnel ? Math.max(funnel.clicks, funnel.signups, 1) : 1;

  return (
    <div className="space-y-6" role="tabpanel">
      {/* Balance Card */}
      {balance && (
        <Card title="Balance">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1">Total Earned</p>
              <p className="text-xl font-bold text-[hsl(var(--foreground))]">{formatCents(balance.totalEarnedCents)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1">Paid Out</p>
              <p className="text-xl font-bold text-[hsl(var(--foreground))]">{formatCents(balance.totalPaidOutCents)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1">Pending Payout</p>
              <p className="text-xl font-bold text-[hsl(var(--warning))]">{formatCents(balance.pendingPayoutCents)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1">Balance Owed</p>
              <p className="text-xl font-bold text-[hsl(var(--success))]">{formatCents(balance.balanceOwedCents)}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((c) => (
          <div key={c.label} className="bg-[hsl(var(--card))] rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                {c.label}
              </p>
              <span className="text-[hsl(var(--muted-foreground))]">{c.icon}</span>
            </div>
            <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Earnings Chart */}
      {chartData.length > 0 && (
        <Card title="Earnings Over Time">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                  }}
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Earnings']}
                />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Conversion Funnel */}
      {funnel && (
        <Card title="Conversion Funnel">
          {funnel.clicks === 0 && funnel.signups === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No funnel data yet. Share your affiliate link to start tracking conversions.
            </p>
          ) : (
            <div className="space-y-3">
              {funnelSteps.map((step, i) => (
                <div key={step.label}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[hsl(var(--foreground))]">{step.label}</span>
                      {step.rate !== null && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {step.rate}%
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">{step.value.toLocaleString()}</span>
                  </div>
                  <div className="h-3 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[hsl(var(--primary))] rounded-full"
                      style={{ width: `${Math.max((step.value / funnelMax) * 100, step.value > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  {i < funnelSteps.length - 1 && (
                    <div className="flex justify-center my-1">
                      <ArrowRight className="h-3 w-3 text-[hsl(var(--muted-foreground))] rotate-90" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Affiliate link */}
      {affiliateLink && (
        <Card>
          <p className="text-sm font-medium text-[hsl(var(--foreground))] mb-2">
            Your Affiliate Link
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={affiliateLink}
              className="flex-1 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-[var(--radius)] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
            />
            <Button onClick={copyLink} size="md">
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx]} ${year.slice(2)}`;
}

export { DashboardTab };
