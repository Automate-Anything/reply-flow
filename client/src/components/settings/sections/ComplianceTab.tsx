import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface HealthData {
  channelId: number;
  channelStatus: string;
  channel_type: string;
  healthScore: number;              // 0–1 (weighted score)
  healthStatus: 'healthy' | 'needs_attention' | 'at_risk' | 'no_data';
  groupCount: number;
  breakdown: {
    responseRate7d: number | null;   // percentage
    outbound7d: number;
    inbound7d: number;
    rateLimitUtilization: number;    // 0–100 percentage
    rateLimit: {
      limit: number;
      remaining: number;
      resetsAt: string;
    };
    whapi: {
      riskFactor: number | null;
      riskFactorContacts: number | null;
      riskFactorChats: number | null;
      lifeTime: number | null;
      fetchedAt: string;
    } | null;
  };
}

interface SafetyMeterData {
  cached?: boolean;
  score?: number | null;
  message?: string;
  risk_factor: number | null;
  risk_factor_contacts: number | null;
  risk_factor_chats: number | null;
  life_time: number | null;
  fetched_at: string | null;
}

interface ComplianceEvent {
  id: string | number;
  created_at: string;
  event_type: string;
  event_data: unknown;
}

interface ComplianceEventsData {
  events: ComplianceEvent[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function healthLabel(status: HealthData['healthStatus']): { label: string; color: string; ring: string } {
  switch (status) {
    case 'healthy':         return { label: 'Healthy', color: 'bg-green-500', ring: 'ring-green-200' };
    case 'needs_attention':  return { label: 'Needs Attention', color: 'bg-yellow-400', ring: 'ring-yellow-200' };
    case 'at_risk':          return { label: 'At Risk', color: 'bg-red-500', ring: 'ring-red-200' };
    case 'no_data':
    default:                return { label: 'No Data', color: 'bg-gray-400', ring: 'ring-gray-200' };
  }
}

/** Risk factor 1–3 scale: 3=good, 2=medium, 1=bad */
function riskFactorColor(value: number | null): string {
  if (value === null) return 'text-gray-400';
  if (value >= 3) return 'text-green-600';
  if (value === 2) return 'text-yellow-600';
  return 'text-red-600';
}

function riskFactorLabel(value: number | null): string {
  if (value === null) return '—';
  if (value >= 3) return 'Good';
  if (value === 2) return 'Medium';
  return 'Poor';
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function canRefreshSafety(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true;
  const diff = Date.now() - new Date(fetchedAt).getTime();
  return diff >= 24 * 60 * 60 * 1000;
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  channelId: number;
  companyId: string;
}

export default function ComplianceTab({ channelId }: Props) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [safety, setSafety] = useState<SafetyMeterData | null>(null);
  const [events, setEvents] = useState<ComplianceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingSafety, setRefreshingSafety] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      try {
        const [healthRes, safetyRes, eventsRes] = await Promise.allSettled([
          api.get<HealthData>(`/compliance/channels/${channelId}/health`),
          api.get<SafetyMeterData>(`/compliance/channels/${channelId}/safety-meter`),
          api.get<ComplianceEventsData>(`/compliance/channels/${channelId}/events`),
        ]);

        if (cancelled) return;

        if (healthRes.status === 'fulfilled') setHealth(healthRes.value.data);
        if (safetyRes.status === 'fulfilled') setSafety(safetyRes.value.data);
        if (eventsRes.status === 'fulfilled') setEvents(eventsRes.value.data.events ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [channelId]);

  const handleRefreshSafety = async () => {
    setRefreshingSafety(true);
    try {
      const { data } = await api.get<SafetyMeterData>(
        `/compliance/channels/${channelId}/safety-meter?refresh=true`
      );
      setSafety(data);
      toast.success('Safety scores refreshed');
    } catch {
      toast.error('Failed to refresh safety scores');
    } finally {
      setRefreshingSafety(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const channelType = health?.channel_type ?? 'whatsapp';
  const isWhatsApp = channelType === 'whatsapp';

  const healthStatus = health?.healthStatus ?? 'no_data';
  const { label: hLabel, color: hColor, ring: hRing } = healthLabel(healthStatus);

  const responseRate7d = health?.breakdown?.responseRate7d ?? null;

  const uniqueEventTypes = Array.from(new Set(events.map((e) => e.event_type)));
  const filteredEvents =
    eventFilter === 'all' ? events : events.filter((e) => e.event_type === eventFilter);

  const refreshAllowed = canRefreshSafety(safety?.fetched_at ?? null);

  return (
    <div className="space-y-5">

      {/* ── 1. Health Score ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 rounded-lg border p-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-4 ${hColor} ${hRing}`}
        />
        <div>
          <p className="text-sm font-semibold">{hLabel}</p>
          <p className="text-xs text-muted-foreground">
            {healthStatus !== 'no_data'
              ? `Compliance score: ${Math.round((health?.healthScore ?? 0) * 100)}/100`
              : 'No compliance data yet'}
          </p>
        </div>
      </div>

      {/* ── 2. Response rate warning ─────────────────────────────────────── */}
      {responseRate7d !== null && responseRate7d < 30 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p className="text-sm font-medium text-yellow-900">
            Low response rate ({Math.round(responseRate7d)}%). Contacts who don't reply
            increase your ban risk.
          </p>
        </div>
      )}

      {/* ── 3. Group monitoring warning (WhatsApp only) ────────────────── */}
      {isWhatsApp && health && health.groupCount >= 50 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p className="text-sm text-yellow-900">
            Monitoring many groups ({health.groupCount}) may draw attention to your account.
          </p>
        </div>
      )}

      {/* ── 4. Metrics cards ─────────────────────────────────────────────── */}
      {health?.breakdown && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Activity Metrics
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricCard label="Outbound messages (7d)" value={health.breakdown.outbound7d} />
            <MetricCard label="Inbound replies (7d)" value={health.breakdown.inbound7d} />
            <MetricCard
              label="Response rate (7d)"
              value={health.breakdown.responseRate7d !== null ? `${Math.round(health.breakdown.responseRate7d)}%` : '—'}
            />
            <MetricCard
              label="Rate limit usage"
              value={`${Math.round(health.breakdown.rateLimitUtilization)}%`}
            />
            <MetricCard
              label="Rate limit remaining"
              value={`${health.breakdown.rateLimit.remaining} / ${health.breakdown.rateLimit.limit}`}
            />
            <MetricCard label="Monitored groups" value={health.groupCount} />
          </div>
        </div>
      )}

      {/* ── 5. Account Safety Score (WhatsApp only) ──────────────────────── */}
      {isWhatsApp && (
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Account Safety Score</p>
            {safety?.fetched_at && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Last refreshed {formatTimestamp(safety.fetched_at)}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshSafety}
            disabled={refreshingSafety || !refreshAllowed}
            title={refreshAllowed ? undefined : 'Can only refresh once per 24 hours'}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshingSafety ? 'animate-spin' : ''}`} />
            {refreshingSafety ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {safety && (safety.risk_factor !== null || safety.risk_factor_contacts !== null || safety.risk_factor_chats !== null) ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-sm text-foreground">Overall Risk</p>
              <p className={`text-sm font-semibold ${riskFactorColor(safety.risk_factor)}`}>
                {riskFactorLabel(safety.risk_factor)}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-sm text-foreground">Contact Coverage</p>
              <p className={`text-sm font-semibold ${riskFactorColor(safety.risk_factor_contacts)}`}>
                {riskFactorLabel(safety.risk_factor_contacts)}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-sm text-foreground">Response Rate</p>
              <p className={`text-sm font-semibold ${riskFactorColor(safety.risk_factor_chats)}`}>
                {riskFactorLabel(safety.risk_factor_chats)}
              </p>
            </div>
            {safety.life_time !== null && (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-sm text-foreground">Account Lifetime</p>
                <p className="text-sm font-semibold text-foreground">
                  {safety.life_time} days
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No safety scores available. Click Refresh to fetch your account safety score.
          </p>
        )}
      </div>
      )}

      {/* ── 5b. Email health placeholder ──────────────────────────────────── */}
      {channelType === 'email' && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">Email Health</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Email health metrics will be available after your first 100 sent emails.
          </p>
        </div>
      )}

      {/* ── 6. Recent Events ─────────────────────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Recent Events</p>
          {uniqueEventTypes.length > 0 && (
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {uniqueEventTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {filteredEvents.length > 0 ? (
          <div className="mt-3 max-h-72 overflow-y-auto space-y-2 pr-1">
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-0.5 rounded-md border bg-muted/20 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{event.event_type}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatTimestamp(event.created_at)}
                  </span>
                </div>
                {event.event_data != null && (
                  <p className="text-muted-foreground">
                    {typeof event.event_data === 'string'
                      ? event.event_data
                      : JSON.stringify(event.event_data) as string}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {events.length === 0 ? 'No compliance events recorded.' : 'No events match the selected filter.'}
          </p>
        )}
      </div>

    </div>
  );
}
