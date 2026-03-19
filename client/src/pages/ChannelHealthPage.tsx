import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, ChevronRight, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { formatChannelName, formatPhoneDisplay, getStatusConfig, type ChannelInfo } from '@/components/settings/channelHelpers';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChannelHealthEntry {
  channelId: number;
  channelStatus: string;
  healthScore: number;
  healthStatus: 'healthy' | 'needs_attention' | 'at_risk' | 'no_data';
  responseRate7d: number | null;
  rateLimitUtilization: number;
  riskFactor: number | null;
}

interface MergedChannel extends ChannelHealthEntry {
  channelInfo: ChannelInfo | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getHealthDot(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':       return 'bg-green-500';
    case 'needs_attention': return 'bg-amber-500';
    case 'at_risk':       return 'bg-red-500';
    default:              return 'bg-muted-foreground/40';
  }
}

function getHealthLabel(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':         return 'Healthy';
    case 'needs_attention': return 'Needs Attention';
    case 'at_risk':         return 'At Risk';
    default:                return 'No Data';
  }
}

function getHealthBadgeClass(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
    case 'needs_attention':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'at_risk':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-muted/50 text-muted-foreground border-border';
  }
}

function getRiskLabel(riskFactor: number | null): string {
  if (riskFactor === null) return '—';
  if (riskFactor >= 3) return 'Low';
  if (riskFactor === 2) return 'Medium';
  return 'High';
}

function getRiskClass(riskFactor: number | null): string {
  if (riskFactor === null) return 'text-muted-foreground';
  if (riskFactor >= 3) return 'text-green-600 dark:text-green-400';
  if (riskFactor === 2) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getChannelDisplayName(channel: MergedChannel): string {
  const info = channel.channelInfo;
  if (!info) return `Channel ${channel.channelId}`;
  return info.profile_name || formatChannelName(info);
}

function getChannelPhone(channel: MergedChannel): string | null {
  const info = channel.channelInfo;
  if (!info?.phone_number) return null;
  return formatPhoneDisplay(info.phone_number);
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ChannelHealthPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<MergedChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [healthRes, channelsRes] = await Promise.all([
          api.get('/compliance/channels/health'),
          api.get('/whatsapp/channels'),
        ]);

        if (cancelled) return;

        const healthEntries: ChannelHealthEntry[] = healthRes.data.channels ?? [];
        const channelInfoList: ChannelInfo[] = channelsRes.data.channels ?? [];
        const infoMap = new Map(channelInfoList.map((c) => [c.id, c]));

        const merged: MergedChannel[] = healthEntries.map((entry) => ({
          ...entry,
          channelInfo: infoMap.get(entry.channelId) ?? null,
        }));

        // Sort: at_risk first, then needs_attention, then healthy, then no_data
        const order = { at_risk: 0, needs_attention: 1, healthy: 2, no_data: 3 };
        merged.sort((a, b) => order[a.healthStatus] - order[b.healthStatus]);

        setChannels(merged);
      } catch {
        toast.error('Failed to load channel health data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 animate-in fade-in duration-150">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Channel Health</h2>
        <p className="text-sm text-muted-foreground">
          Monitor the health and compliance status of all your WhatsApp channels.
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="py-0 gap-0">
              <CardContent className="flex items-center gap-4 py-4 px-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <ShieldCheck className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No channels to display</p>
            <p className="text-xs text-muted-foreground">
              Connect a WhatsApp channel to start tracking health.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Column header row */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_120px_100px_100px_80px_24px] items-center gap-4 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Channel</span>
            <span>Health</span>
            <span>Rate Limit</span>
            <span>WhAPI Risk</span>
            <span>Status</span>
            <span />
          </div>

          <div className="space-y-2">
            {channels.map((ch) => {
              const statusConfig = getStatusConfig(ch.channelStatus);
              const displayName = getChannelDisplayName(ch);
              const phone = getChannelPhone(ch);

              return (
                <Card
                  key={ch.channelId}
                  className="cursor-pointer transition-all hover:bg-accent/50 hover:border-primary/30 group py-0 gap-0"
                  onClick={() => navigate(`/channels/${ch.channelId}`)}
                >
                  <CardContent className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_100px_100px_80px_24px] items-center gap-4 py-4 px-4">
                    {/* Channel name + phone */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{displayName}</p>
                        {phone && (
                          <p className="text-xs text-muted-foreground truncate">{phone}</p>
                        )}
                      </div>
                    </div>

                    {/* Health badge */}
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${getHealthDot(ch.healthStatus)}`} />
                      <Badge
                        variant="outline"
                        className={`text-xs whitespace-nowrap ${getHealthBadgeClass(ch.healthStatus)}`}
                      >
                        {getHealthLabel(ch.healthStatus)}
                      </Badge>
                    </div>

                    {/* Rate limit utilization */}
                    <div className="hidden sm:block">
                      <p className="text-sm font-medium">
                        {ch.rateLimitUtilization.toFixed(0)}%
                      </p>
                      <p className="text-xs text-muted-foreground">used</p>
                    </div>

                    {/* WhAPI risk factor */}
                    <div className="hidden sm:block">
                      <p className={`text-sm font-medium ${getRiskClass(ch.riskFactor)}`}>
                        {getRiskLabel(ch.riskFactor)}
                      </p>
                      <p className="text-xs text-muted-foreground">risk</p>
                    </div>

                    {/* Channel connection status */}
                    <div className="hidden sm:block">
                      <Badge
                        variant="outline"
                        className={`text-xs ${statusConfig.badgeClass}`}
                      >
                        {statusConfig.label}
                      </Badge>
                    </div>

                    {/* Chevron */}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
