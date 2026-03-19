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
  score: number | null; // 0–100 or null if no data
  metrics: {
    messages_sent_today: number;
    messages_sent_week: number;
    response_rate_24h: number | null;
    response_rate_7d: number | null;
    rate_limit_usage: number | null; // 0–100 percentage
    auto_replies_today: number;
    ai_responses_today: number;
    content_warnings_7d: number;
  };
  group_count: number;
  send_rate_reduced: boolean;
}

interface SafetyMeterData {
  scores: {
    label: string;
    value: number; // 0–100
    last_refreshed: string | null;
  }[];
  last_refresh: string | null;
}

interface ComplianceEvent {
  id: string | number;
  timestamp: string;
  event_type: string;
  details: string;
}

interface ComplianceEventsData {
  events: ComplianceEvent[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function healthLabel(score: number | null): { label: string; color: string; ring: string } {
  if (score === null) return { label: 'No Data', color: 'bg-gray-400', ring: 'ring-gray-200' };
  if (score >= 70) return { label: 'Healthy', color: 'bg-green-500', ring: 'ring-green-200' };
  if (score >= 40) return { label: 'Needs Attention', color: 'bg-yellow-400', ring: 'ring-yellow-200' };
  return { label: 'At Risk', color: 'bg-red-500', ring: 'ring-red-200' };
}

function safetyScoreColor(value: number): string {
  if (value >= 70) return 'text-green-600';
  if (value >= 40) return 'text-yellow-600';
  return 'text-red-600';
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

function canRefreshSafety(lastRefresh: string | null): boolean {
  if (!lastRefresh) return true;
  const diff = Date.now() - new Date(lastRefresh).getTime();
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
      const { data } = await api.post<SafetyMeterData>(
        `/compliance/channels/${channelId}/safety-meter/refresh`
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

  const { label: hLabel, color: hColor, ring: hRing } = healthLabel(health?.score ?? null);

  const metrics = health?.metrics;
  const responseRate24h = metrics?.response_rate_24h ?? null;
  const responseRate7d = metrics?.response_rate_7d ?? null;
  // Use 24h rate for warnings; fall back to 7d
  const primaryResponseRate = responseRate24h ?? responseRate7d ?? null;

  const uniqueEventTypes = Array.from(new Set(events.map((e) => e.event_type)));
  const filteredEvents =
    eventFilter === 'all' ? events : events.filter((e) => e.event_type === eventFilter);

  const refreshAllowed = canRefreshSafety(safety?.last_refresh ?? null);

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
            {health?.score !== null && health?.score !== undefined
              ? `Compliance score: ${health.score}/100`
              : 'No compliance data yet'}
          </p>
        </div>
      </div>

      {/* ── 2. Response rate warning ─────────────────────────────────────── */}
      {primaryResponseRate !== null && primaryResponseRate < 30 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-yellow-900">
              Low response rate ({Math.round(primaryResponseRate)}%). Contacts who don't reply
              increase your ban risk.
            </p>
            {primaryResponseRate < 10 && health?.send_rate_reduced && (
              <p className="text-xs text-yellow-800">
                Your send rate has been automatically reduced to protect your account.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── 3. Group monitoring warning ──────────────────────────────────── */}
      {health && health.group_count >= 50 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p className="text-sm text-yellow-900">
            Monitoring many groups ({health.group_count}) may draw attention to your account.
          </p>
        </div>
      )}

      {/* ── 4. Metrics cards ─────────────────────────────────────────────── */}
      {metrics && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Activity Metrics
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricCard label="Messages sent today" value={metrics.messages_sent_today} />
            <MetricCard label="Messages sent this week" value={metrics.messages_sent_week} />
            <MetricCard
              label="Response rate (24h)"
              value={metrics.response_rate_24h !== null ? `${Math.round(metrics.response_rate_24h)}%` : '—'}
            />
            <MetricCard
              label="Response rate (7d)"
              value={metrics.response_rate_7d !== null ? `${Math.round(metrics.response_rate_7d)}%` : '—'}
            />
            <MetricCard
              label="Rate limit usage"
              value={metrics.rate_limit_usage !== null ? `${Math.round(metrics.rate_limit_usage)}%` : '—'}
            />
            <MetricCard label="Auto-replies today" value={metrics.auto_replies_today} />
            <MetricCard label="AI responses today" value={metrics.ai_responses_today} />
            <MetricCard label="Content warnings (7d)" value={metrics.content_warnings_7d} />
          </div>
        </div>
      )}

      {/* ── 5. WhAPI Safety Meter ─────────────────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">WhAPI Safety Meter</p>
            {safety?.last_refresh && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Last refreshed {formatTimestamp(safety.last_refresh)}
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

        {safety && safety.scores.length > 0 ? (
          <div className="mt-3 space-y-2">
            {safety.scores.map((score) => (
              <div key={score.label} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-sm text-foreground">{score.label}</p>
                <p className={`text-sm font-semibold ${safetyScoreColor(score.value)}`}>
                  {score.value}/100
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No safety scores available. Click Refresh to fetch scores from WhAPI.
          </p>
        )}
      </div>

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
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                <p className="text-muted-foreground">{event.details}</p>
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
