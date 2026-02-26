import { useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, Smartphone } from 'lucide-react';
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

export default function WhatsAppChannelCard({ channel, onUpdate }: Props) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
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
  const needsQR = channel.channel_status === 'awaiting_scan' || channel.channel_status === 'disconnected';

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            isConnected ? 'bg-green-500/10' : 'bg-muted'
          }`}>
            {isConnected ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <Smartphone className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">
                {channel.phone_number || channel.channel_name}
              </p>
              <Badge variant={isConnected ? 'default' : 'secondary'} className="shrink-0">
                {isConnected ? 'Connected' : channel.channel_status === 'pending' ? 'Provisioning' : 'Disconnected'}
              </Badge>
            </div>
            {channel.phone_number && channel.channel_name !== channel.phone_number && (
              <p className="text-sm text-muted-foreground">{channel.channel_name}</p>
            )}
          </div>
        </div>

        {/* QR code display for reconnect */}
        {showQR && needsQR && (
          <div className="mt-4 flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your WhatsApp app
            </p>
            {qrData ? (
              <div className="rounded-lg border bg-white p-4">
                <QRCodeSVG value={qrData} size={200} />
              </div>
            ) : (
              <Skeleton className="h-[232px] w-[232px]" />
            )}
            <p className="text-xs text-muted-foreground">
              Checking connection every 5 seconds...
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
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
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting || disconnecting}>
            {deleting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Trash2 className="mr-2 h-3 w-3" />}
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
