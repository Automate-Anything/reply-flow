import { useState, useEffect, useCallback } from 'react';
import { usePageReady } from '@/hooks/usePageReady';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Smartphone, Mail, Plus, CheckCircle2, CircleX, QrCode, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import GmailConnection from '@/components/settings/GmailConnection';
import { formatChannelName, getStatusConfig, getCardBorder, type ChannelInfo } from '@/components/settings/channelHelpers';
import { getChannelConfig } from '@/lib/channelTypes';
import { cn } from '@/lib/utils';
import { useSubscription } from '@/hooks/useSubscription';

// ── Health types & helpers ─────────────────────────────────────────────────

interface ChannelHealthEntry {
  channelId: number;
  healthStatus: 'healthy' | 'needs_attention' | 'at_risk' | 'no_data';
  rateLimitUtilization: number;
  riskFactor: number | null;
}

function getHealthDot(status: ChannelHealthEntry['healthStatus']): string {
  switch (status) {
    case 'healthy':         return 'bg-green-500';
    case 'needs_attention': return 'bg-amber-500';
    case 'at_risk':         return 'bg-red-500';
    default:                return 'bg-muted-foreground/40';
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
      return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800';
    case 'needs_attention':
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800';
    case 'at_risk':
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function getRiskLabel(riskFactor: number | null): string {
  if (riskFactor === null) return '\u2014';
  if (riskFactor < 0.34) return 'Low';
  if (riskFactor < 0.67) return 'Medium';
  return 'High';
}

function getRiskClass(riskFactor: number | null): string {
  if (riskFactor === null) return 'text-muted-foreground';
  if (riskFactor < 0.34) return 'text-green-600 dark:text-green-400';
  if (riskFactor < 0.67) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
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

function getChannelDisplayName(ch: ChannelInfo): string {
  if (ch.profile_name) return ch.profile_name;
  if (ch.channel_type === 'email' && ch.email_address) return ch.email_address;
  if (ch.phone_number) return formatPhone(ch.phone_number);
  return formatChannelName(ch);
}

function getChannelSubtext(ch: ChannelInfo, statusLabel: string): string {
  const parts: string[] = [];
  if (ch.channel_type === 'email') {
    if (ch.email_address && ch.profile_name) parts.push(ch.email_address);
  } else {
    if (ch.phone_number && ch.profile_name) parts.push(formatPhone(ch.phone_number));
  }
  parts.push(statusLabel);
  return parts.join(' \u00b7 ');
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
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [showWhatsAppFlow, setShowWhatsAppFlow] = useState(false);
  const [showGmailFlow, setShowGmailFlow] = useState(false);
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
      const { data } = await api.get('/channels/whatsapp/channels');
      const nextChannels = data.channels || [];
      setChannels(nextChannels);
      try {
        localStorage.setItem(CHANNELS_CACHE_KEY, JSON.stringify(nextChannels));
      } catch {
        // localStorage full — ignore
      }
      if (showLoader) setLoading(false);

      // Only fetch WhatsApp metadata for WhatsApp channels
      const channelsNeedingMetadata = nextChannels.filter((channel: ChannelInfo) =>
        channel.channel_status === 'connected' &&
        (channel.channel_type === 'whatsapp' || !channel.channel_type) &&
        (
          !channel.phone_number ||
          !channel.profile_name ||
          !channel.profile_picture_url
        )
      );

      if (channelsNeedingMetadata.length > 0) {
        void (async () => {
          await Promise.allSettled(
            channelsNeedingMetadata.map((channel: ChannelInfo) =>
              api.get(`/channels/whatsapp/health-check?channelId=${channel.id}`)
            )
          );

          const { data: refreshedData } = await api.get('/channels/whatsapp/channels');
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

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    try {
      const { data } = await api.post('/channels/gmail/connect', { channelName: 'Gmail' });
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      toast.error('Failed to start Gmail connection');
      setConnectingGmail(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 animate-in fade-in duration-150">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Channels</h2>
          <p className="text-sm text-muted-foreground">
            Connect and manage your channels.
          </p>
          {!subLoading && subscription && (
            <p className="mt-1 text-xs text-muted-foreground">
              {channels.length} / {channelLimit} channels used
            </p>
          )}
        </div>
        {!loading && !atLimit && (
          <Button onClick={() => setConnectDialogOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Connect Channel
          </Button>
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
                const chConfig = getChannelConfig(ch.channel_type);
                const ChIcon = chConfig.icon;
                return (
                  <Card
                    key={ch.id}
                    className={`cursor-pointer transition-all hover:bg-accent/50 hover:border-primary/30 group py-0 gap-0 ${borderClass || ''}`}
                    onClick={() => navigate(`/channels/${ch.id}`)}
                  >
                    <CardContent className="flex items-center gap-3 py-4 px-4">
                      {/* Avatar + status icon */}
                      <div className="relative shrink-0">
                        <Avatar>
                          {ch.profile_picture_url ? (
                            <AvatarImage src={ch.profile_picture_url} alt={getChannelDisplayName(ch)} />
                          ) : null}
                          <AvatarFallback>
                            <ChIcon className={cn('h-4 w-4', chConfig.color)} />
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background">
                          {getStatusIcon(ch.channel_status)}
                        </span>
                      </div>

                      {/* Channel name + identifier — always visible */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-medium">
                            {getChannelDisplayName(ch)}
                          </p>
                          <Badge variant="secondary" className={cn('shrink-0 text-[10px] px-1.5 py-0', chConfig.bgColor, chConfig.color)}>
                            {chConfig.label}
                          </Badge>
                        </div>
                        <p className={`text-xs ${ch.channel_status === 'disconnected' ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {getChannelSubtext(ch, status.label)}
                        </p>
                      </div>

                      {/* sm+: rich health grid */}
                      {health && (
                        <div className="hidden sm:flex items-center gap-4 shrink-0">
                          {/* Health badge */}
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge
                              variant="outline"
                              className={`flex items-center gap-1 text-xs px-2 py-0.5 font-medium ${getHealthBadgeClass(health.healthStatus)}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getHealthDot(health.healthStatus)}`} />
                              {getHealthLabel(health.healthStatus)}
                            </Badge>
                          </div>

                          {/* Rate Limit */}
                          <div className="flex flex-col items-center min-w-[3rem]">
                            <span className="text-sm font-semibold tabular-nums">
                              {health.rateLimitUtilization.toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight">used</span>
                          </div>

                          {/* Risk Level */}
                          <div className="flex flex-col items-center min-w-[3rem]">
                            <span className={`text-sm font-semibold ${getRiskClass(health.riskFactor)}`}>
                              {getRiskLabel(health.riskFactor)}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight">risk</span>
                          </div>
                        </div>
                      )}

                      {/* Mobile: minimal health dot only */}
                      {health && (
                        <span className={`sm:hidden h-2 w-2 rounded-full shrink-0 ${getHealthDot(health.healthStatus)}`} />
                      )}

                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
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
                <p className="text-xs text-muted-foreground">Connect a channel to start receiving messages.</p>
              </CardContent>
            </Card>
          )}

          {/* Inline WhatsApp flow (shown when user picks WhatsApp from the dialog) */}
          {showWhatsAppFlow && !atLimit && (
            <WhatsAppConnection onCreated={() => { setShowWhatsAppFlow(false); fetchChannels(); }} />
          )}

          {/* Inline Gmail flow (shown when user picks Gmail from the dialog) */}
          {showGmailFlow && !atLimit && (
            <GmailConnection onCreated={() => { setShowGmailFlow(false); fetchChannels(); }} />
          )}
        </div>
      )}

      {/* Connect Channel Type Picker Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a Channel</DialogTitle>
            <DialogDescription>
              Choose which type of channel you want to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <button
              className="flex items-center gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
              onClick={() => {
                setConnectDialogOpen(false);
                setShowWhatsAppFlow(true);
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 dark:bg-green-950/40">
                <Smartphone className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="text-xs text-muted-foreground">
                  Connect a WhatsApp Business number via QR code
                </p>
              </div>
            </button>
            <button
              className="flex items-center gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
              onClick={() => {
                setConnectDialogOpen(false);
                setShowGmailFlow(true);
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
                <Mail className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium">Gmail</p>
                <p className="text-xs text-muted-foreground">
                  Connect a Gmail account via Google sign-in
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
