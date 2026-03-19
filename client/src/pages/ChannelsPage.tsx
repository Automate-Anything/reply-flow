import { useState, useEffect, useCallback } from 'react';
import { usePageReady } from '@/hooks/usePageReady';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Smartphone, CheckCircle2, CircleX, QrCode, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import { formatChannelName, getStatusConfig, getCardBorder, type ChannelInfo } from '@/components/settings/channelHelpers';
import { useSubscription } from '@/hooks/useSubscription';

// ── Health types & helpers ─────────────────────────────────────────────────

interface ChannelHealthEntry {
  channelId: number;
  healthStatus: 'healthy' | 'needs_attention' | 'at_risk' | 'no_data';
  rateLimitUtilization: number;
}

function getHealthDot(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':         return 'bg-green-500';
    case 'needs_attention': return 'bg-amber-500';
    case 'at_risk':         return 'bg-red-500';
    default:                return 'bg-muted-foreground/40';
  }
}

function getHealthTooltip(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':         return 'Healthy';
    case 'needs_attention': return 'Needs Attention';
    case 'at_risk':         return 'At Risk';
    default:                return 'No Data';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case 'pending':
      return <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />;
    case 'awaiting_scan':
      return <QrCode className="h-3 w-3 text-blue-500" />;
    default:
      return <CircleX className="h-3 w-3 text-destructive" />;
  }
}

function formatPhone(phone: string): string {
  // Format phone like +1 (234) 567-8901 if it's a US-style number, otherwise just prefix with +
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length >= 10) {
    return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
  }
  return `+${digits}`;
}

const CHANNELS_CACHE_KEY = 'reply-flow-channels';

function getCachedChannels(): ChannelInfo[] | null {
  try {
    const cached = localStorage.getItem(CHANNELS_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export default function ChannelsPage() {
  const navigate = useNavigate();
  const cachedChannels = getCachedChannels();
  const [channels, setChannels] = useState<ChannelInfo[]>(cachedChannels || []);
  const [channelsLoading, setLoading] = useState(!cachedChannels);
  const [healthMap, setHealthMap] = useState<Map<number, ChannelHealthEntry>>(new Map());
  const pageReady = usePageReady();
  const loading = channelsLoading || !pageReady;
  const { subscription, loading: subLoading } = useSubscription();

  const channelLimit = subscription?.plan.channels ?? Infinity;
  const atLimit = channels.length >= channelLimit;

  // Fetch health data in background (non-blocking)
  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      try {
        const { data } = await api.get('/compliance/channels/health');
        if (cancelled) return;
        const entries: ChannelHealthEntry[] = data.channels ?? [];
        setHealthMap(new Map(entries.map((e) => [e.channelId, e])));
      } catch {
        // Health data is supplementary — don't block the page on failure
      }
    }
    void loadHealth();
    return () => { cancelled = true; };
  }, []);

  const fetchChannels = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const { data } = await api.get('/whatsapp/channels');
      const nextChannels = data.channels || [];
      setChannels(nextChannels);
      try {
        localStorage.setItem(CHANNELS_CACHE_KEY, JSON.stringify(nextChannels));
      } catch {
        // localStorage full — ignore
      }
      if (showLoader) setLoading(false);

      const channelsNeedingMetadata = nextChannels.filter((channel: ChannelInfo) =>
        channel.channel_status === 'connected' && (
          !channel.phone_number ||
          !channel.profile_name ||
          !channel.profile_picture_url
        )
      );

      if (channelsNeedingMetadata.length > 0) {
        void (async () => {
          await Promise.allSettled(
            channelsNeedingMetadata.map((channel: ChannelInfo) =>
              api.get(`/whatsapp/health-check?channelId=${channel.id}`)
            )
          );

          const { data: refreshedData } = await api.get('/whatsapp/channels');
          setChannels(refreshedData.channels || []);
        })();
      }
    } catch {
      toast.error('Failed to load channels');
    } finally {
      if (!showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels(!cachedChannels);
  }, [fetchChannels]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 animate-in fade-in duration-150">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground">
          Connect and manage your WhatsApp lines.
        </p>
        {!subLoading && subscription && (
          <p className="mt-1 text-xs text-muted-foreground">
            {channels.length} / {channelLimit} channels used
          </p>
        )}
      </div>

      {atLimit && !loading && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between py-3 px-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              You've reached the channel limit for your <span className="font-semibold">{subscription?.plan.name}</span> plan ({channelLimit} channel{channelLimit !== 1 ? 's' : ''}).
            </p>
            <Button size="sm" variant="outline" className="ml-4 shrink-0" onClick={() => navigate('/company-settings?tab=billing')}>
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Channel List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="py-0 gap-0">
              <CardContent className="flex items-center gap-3 py-4 px-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {channels.length > 0 && (
            <div className="space-y-2">
              {channels.map((ch) => {
                const status = getStatusConfig(ch.channel_status);
                const borderClass = getCardBorder(ch.channel_status);
                const health = healthMap.get(ch.id);
                return (
                  <Card
                    key={ch.id}
                    className={`cursor-pointer transition-all hover:bg-accent/50 hover:border-primary/30 group py-0 gap-0 ${borderClass || ''}`}
                    onClick={() => navigate(`/channels/${ch.id}`)}
                  >
                    <CardContent className="flex items-center gap-3 py-4 px-4">
                      <div className="relative">
                        <Avatar>
                          {ch.profile_picture_url ? (
                            <AvatarImage src={ch.profile_picture_url} alt={formatChannelName(ch)} />
                          ) : null}
                          <AvatarFallback>
                            <Smartphone className="h-4 w-4 text-muted-foreground" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background">
                          {getStatusIcon(ch.channel_status)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {ch.profile_name || (ch.phone_number ? formatPhone(ch.phone_number) : formatChannelName(ch))}
                        </p>
                        <p className={`text-xs ${ch.channel_status === 'disconnected' ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {ch.phone_number && ch.profile_name ? `${formatPhone(ch.phone_number)} · ` : ''}{status.label}
                        </p>
                      </div>

                      {/* Health indicator + rate limit */}
                      {health && (
                        <div className="hidden sm:flex items-center gap-2 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`h-2 w-2 rounded-full shrink-0 ${getHealthDot(health.healthStatus)}`} />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {getHealthTooltip(health.healthStatus)}
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {health.rateLimitUtilization.toFixed(0)}%
                          </span>
                        </div>
                      )}

                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {channels.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <Smartphone className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No channels yet</p>
                <p className="text-xs text-muted-foreground">Create a new WhatsApp channel below.</p>
              </CardContent>
            </Card>
          )}

          {!atLimit && <WhatsAppConnection onCreated={fetchChannels} />}
        </div>
      )}
    </div>
  );
}
