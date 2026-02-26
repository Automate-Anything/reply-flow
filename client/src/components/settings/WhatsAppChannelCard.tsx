import { useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, WifiOff } from 'lucide-react';
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
  // Strip the "reply-flow-" prefix and long UUID suffix for cleaner display
  const name = channel.channel_name;
  if (name.startsWith('reply-flow-')) {
    const rest = name.slice('reply-flow-'.length);
    const dashIdx = rest.indexOf('-');
    if (dashIdx > 0) return `Channel ${rest.slice(0, dashIdx).slice(0, 8)}`;
  }
  // Truncate very long names
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

function getStatusConfig(channel: ChannelInfo): StatusConfig {
  if (channel.channel_status === 'connected') {
    return {
      label: 'Connected',
      badgeClass: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
      dotClass: 'bg-green-500',
      iconBg: 'bg-green-500/10',
      icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
    };
  }
  if (channel.channel_status === 'pending') {
    return {
      label: 'Setting up...',
      badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
      dotClass: 'bg-amber-500 animate-pulse',
      iconBg: 'bg-amber-500/10',
      icon: <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />,
    };
  }
  // disconnected / awaiting_scan
  return {
    label: 'Disconnected',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground/50',
    iconBg: 'bg-muted',
    icon: <WifiOff className="h-5 w-5 text-muted-foreground" />,
  };
}

export default function WhatsAppChannelCard({ channel, onUpdate }: Props) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (healthPollRef.current) {
      clearInterval(healthPollRef.current);
      healthPollRef.current = null;
    }
    if (qrRefreshRef.current) {
      clearInterval(qrRefreshRef.current);
      qrRefreshRef.current = null;
    }
  }, []);

  const startHealthPolling = useCallback(() => {
    if (healthPollRef.current) clearInterval(healthPollRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);

    healthPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${channel.id}`);
        if (data.status === 'connected') {
          clearTimers();
          setShowQR(false);
          setQrData(null);
          toast.success('WhatsApp connected successfully');
          onUpdate();
        }
      } catch {
        // Ignore
      }
    }, 5000);

    qrRefreshRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
        setQrData(data.qr);
      } catch {
        // Ignore
      }
    }, 30000);
  }, [channel.id, clearTimers, onUpdate]);

  const handleReconnect = async () => {
    setShowQR(true);
    setRefreshingQR(true);
    try {
      const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
      setQrData(data.qr);
      startHealthPolling();
    } catch {
      toast.error('Failed to get QR code');
      setShowQR(false);
    } finally {
      setRefreshingQR(false);
    }
  };

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
      clearTimers();
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
      clearTimers();
      toast.success('Channel deleted');
      onUpdate();
    } catch {
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  };

  const isConnected = channel.channel_status === 'connected';
  const isProvisioning = channel.channel_status === 'pending';
  const needsQR = channel.channel_status === 'awaiting_scan' || channel.channel_status === 'disconnected';
  const status = getStatusConfig(channel);
  const displayName = formatChannelName(channel);

  return (
    <Card className={isProvisioning ? 'border-amber-500/30' : isConnected ? 'border-green-500/20' : undefined}>
      <CardContent className="p-5">
        {/* Channel header */}
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${status.iconBg}`}>
            {status.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{displayName}</p>
              <Badge variant="outline" className={`shrink-0 ${status.badgeClass}`}>
                <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
                {status.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {isProvisioning
                ? 'This channel is being set up. This may take a few minutes.'
                : `Created ${timeAgo(channel.created_at)}`}
            </p>
          </div>
        </div>

        {/* QR code display for reconnect */}
        {showQR && needsQR && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-lg border border-dashed bg-muted/30 p-6">
            <p className="text-sm font-medium">
              Scan this QR code with your WhatsApp app
            </p>
            {qrData ? (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <QRCodeSVG value={qrData} size={200} />
              </div>
            ) : (
              <Skeleton className="h-[232px] w-[232px] rounded-lg" />
            )}
            <p className="text-xs text-muted-foreground">
              Checking connection every 5 seconds...
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
          {needsQR && !showQR && (
            <Button variant="outline" size="sm" onClick={handleReconnect}>
              <RefreshCw className="mr-2 h-3 w-3" />
              Reconnect
            </Button>
          )}
          {showQR && (
            <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={refreshingQR}>
              <RefreshCw className={`mr-2 h-3 w-3 ${refreshingQR ? 'animate-spin' : ''}`} />
              {refreshingQR ? 'Refreshing...' : 'Refresh QR'}
            </Button>
          )}

          {/* Delete with inline confirmation */}
          <div className="ml-auto">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delete this channel?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                >
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
        </div>
      </CardContent>
    </Card>
  );
}
