import { useState, useCallback, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, WifiOff, QrCode } from 'lucide-react';
import { toast } from 'sonner';

export interface ChannelInfo {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_status: string;
  phone_number: string | null;
  webhook_registered: boolean;
  created_at: string;
}

interface Props {
  channel: ChannelInfo;
  onUpdate: () => void;
}

function formatChannelName(channel: ChannelInfo): string {
  if (channel.phone_number) return channel.phone_number;
  const name = channel.channel_name;
  if (name.startsWith('reply-flow-')) {
    const rest = name.slice('reply-flow-'.length);
    const dashIdx = rest.indexOf('-');
    if (dashIdx > 0) return `Channel ${rest.slice(0, dashIdx).slice(0, 8)}`;
  }
  return name.length > 24 ? name.slice(0, 24) + '...' : name;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type StatusConfig = {
  label: string;
  badgeClass: string;
  dotClass: string;
  iconBg: string;
  icon: React.ReactNode;
};

function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        badgeClass: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
        dotClass: 'bg-green-500',
        iconBg: 'bg-green-500/10',
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
      };
    case 'pending':
      return {
        label: 'Setting up...',
        badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
        dotClass: 'bg-amber-500 animate-pulse',
        iconBg: 'bg-amber-500/10',
        icon: <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />,
      };
    case 'awaiting_scan':
      return {
        label: 'Scan QR code',
        badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
        dotClass: 'bg-blue-500 animate-pulse',
        iconBg: 'bg-blue-500/10',
        icon: <QrCode className="h-5 w-5 text-blue-500" />,
      };
    default:
      return {
        label: 'Disconnected',
        badgeClass: 'bg-muted text-muted-foreground border-border',
        dotClass: 'bg-muted-foreground/50',
        iconBg: 'bg-muted',
        icon: <WifiOff className="h-5 w-5 text-muted-foreground" />,
      };
  }
}

function getSubtitle(status: string, createdAt: string): string {
  switch (status) {
    case 'pending':
      return 'This channel is being set up. This may take a few minutes.';
    case 'awaiting_scan':
      return 'Scan the QR code below with your WhatsApp app to connect.';
    default:
      return `Created ${timeAgo(createdAt)}`;
  }
}

function getCardBorder(status: string): string | undefined {
  switch (status) {
    case 'pending': return 'border-amber-500/30';
    case 'awaiting_scan': return 'border-blue-500/30';
    case 'connected': return 'border-green-500/20';
    default: return undefined;
  }
}

export default function WhatsAppChannelCard({ channel, onUpdate }: Props) {
  const [effectiveStatus, setEffectiveStatus] = useState(channel.channel_status);
  const [qrData, setQrData] = useState<string | null>(null);
  const [loadingQR, setLoadingQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelledRef = useRef(false);

  // Sync effectiveStatus if the prop changes (e.g., parent re-fetched channels)
  useEffect(() => {
    setEffectiveStatus(channel.channel_status);
  }, [channel.channel_status]);

  // Poll health-check when pending — waiting for provisioning to finish
  useEffect(() => {
    if (effectiveStatus !== 'pending') return;

    const poll = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${channel.id}`);
        if (data.status !== 'pending') {
          setEffectiveStatus(data.status);
          if (data.status === 'connected') {
            toast.success('WhatsApp connected successfully');
            onUpdate();
          }
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [effectiveStatus, channel.id, onUpdate]);

  // When awaiting_scan: fetch QR, auto-refresh, poll for connection
  useEffect(() => {
    if (effectiveStatus !== 'awaiting_scan') return;

    let cancelled = false;
    cancelledRef.current = false;

    const handleQRResponse = (data: { qr?: string; connected?: boolean }) => {
      if (cancelled) return;
      if (data.connected) {
        // Channel is already authenticated — skip QR, go to connected
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        onUpdate();
        return;
      }
      if (data.qr) setQrData(data.qr);
    };

    // Fetch QR immediately
    const fetchQR = async () => {
      setLoadingQR(true);
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
        handleQRResponse(data);
      } catch {
        // Will retry on interval
      } finally {
        if (!cancelled) setLoadingQR(false);
      }
    };
    fetchQR();

    // Refresh QR every 30s
    const qrInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
        handleQRResponse(data);
      } catch {
        // ignore
      }
    }, 30000);

    // Poll health every 5s for connection
    const healthInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${channel.id}`);
        if (data.status === 'connected' && !cancelled) {
          setEffectiveStatus('connected');
          setQrData(null);
          toast.success('WhatsApp connected successfully');
          onUpdate();
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      clearInterval(qrInterval);
      clearInterval(healthInterval);
    };
  }, [effectiveStatus, channel.id, onUpdate]);

  const handleReconnect = useCallback(async () => {
    setEffectiveStatus('awaiting_scan');
    // The effect will handle QR fetching and polling
  }, []);

  const handleRefreshQR = async () => {
    setRefreshingQR(true);
    try {
      const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
      setQrData(data.qr);
    } catch {
      toast.error('Failed to refresh QR code');
    } finally {
      setRefreshingQR(false);
    }
  };

  const handleLogout = async () => {
    setDisconnecting(true);
    try {
      await api.post('/whatsapp/logout', { channelId: channel.id });
      toast.success('WhatsApp disconnected');
      onUpdate();
    } catch {
      toast.error('Failed to disconnect WhatsApp');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await api.delete('/whatsapp/delete-channel', { data: { channelId: channel.id } });
      toast.success('Channel deleted');
      onUpdate();
    } catch {
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  };

  const isConnected = effectiveStatus === 'connected';
  const isProvisioning = effectiveStatus === 'pending';
  const isAwaitingScan = effectiveStatus === 'awaiting_scan';
  const isDisconnected = effectiveStatus === 'disconnected';
  const statusConfig = getStatusConfig(effectiveStatus);
  const displayName = formatChannelName(channel);

  return (
    <Card className={getCardBorder(effectiveStatus)}>
      <CardContent className="p-5">
        {/* Channel header */}
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${statusConfig.iconBg}`}>
            {statusConfig.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{displayName}</p>
              <Badge variant="outline" className={`shrink-0 ${statusConfig.badgeClass}`}>
                <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {getSubtitle(effectiveStatus, channel.created_at)}
            </p>
          </div>
        </div>

        {/* QR code display — shown automatically for awaiting_scan */}
        {isAwaitingScan && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-lg border border-dashed bg-muted/30 p-6">
            <p className="text-sm font-medium">
              Scan this QR code with your WhatsApp app
            </p>
            {loadingQR ? (
              <Skeleton className="h-[232px] w-[232px] rounded-lg" />
            ) : qrData ? (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <QRCodeSVG value={qrData} size={200} />
              </div>
            ) : (
              <div className="flex h-[232px] w-[232px] items-center justify-center rounded-lg border bg-muted/50">
                <p className="text-sm text-muted-foreground">Failed to load QR code</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              QR code refreshes automatically. Checking connection every 5 seconds...
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-2">
          {isConnected && (
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={disconnecting || deleting}>
              {disconnecting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <LogOut className="mr-2 h-3 w-3" />}
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          )}
          {isDisconnected && (
            <Button variant="outline" size="sm" onClick={handleReconnect}>
              <RefreshCw className="mr-2 h-3 w-3" />
              Reconnect
            </Button>
          )}
          {isAwaitingScan && (
            <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={refreshingQR}>
              <RefreshCw className={`mr-2 h-3 w-3 ${refreshingQR ? 'animate-spin' : ''}`} />
              {refreshingQR ? 'Refreshing...' : 'Refresh QR'}
            </Button>
          )}

          {/* Delete with inline confirmation */}
          {!isProvisioning && (
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Delete this channel?</span>
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Trash2 className="mr-2 h-3 w-3" />}
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting || disconnecting}
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
