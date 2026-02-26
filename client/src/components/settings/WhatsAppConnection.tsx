import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Smartphone, Loader2, CheckCircle2, XCircle, RefreshCw, Trash2, LogOut } from 'lucide-react';
import { toast } from 'sonner';

type ConnectionState = 'loading' | 'no_channel' | 'creating' | 'provisioning' | 'qr_display' | 'connected' | 'error';

interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  channel_status: string;
  phone_number: string | null;
  webhook_registered: boolean;
}

export default function WhatsAppConnection() {
  const [state, setState] = useState<ConnectionState>('loading');
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const provisionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (healthPollRef.current) {
      clearInterval(healthPollRef.current);
      healthPollRef.current = null;
    }
    if (qrRefreshRef.current) {
      clearInterval(qrRefreshRef.current);
      qrRefreshRef.current = null;
    }
    if (provisionPollRef.current) {
      clearInterval(provisionPollRef.current);
      provisionPollRef.current = null;
    }
  }, []);

  const fetchChannel = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/channel');
      if (data.channel) {
        setChannel(data.channel);
        if (data.channel.channel_status === 'connected') {
          setState('connected');
        } else if (data.channel.channel_status === 'provisioning') {
          setState('provisioning');
          startProvisionPolling();
        } else {
          // Channel exists and is provisioned — show QR
          setState('qr_display');
          fetchQR();
        }
      } else {
        setState('no_channel');
      }
    } catch {
      setState('no_channel');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll /channel-status every 5s until the channel is provisioned on WhAPI
  const startProvisionPolling = () => {
    if (provisionPollRef.current) {
      clearInterval(provisionPollRef.current);
    }
    const startTime = Date.now();
    provisionPollRef.current = setInterval(async () => {
      // Give up after 5 minutes
      if (Date.now() - startTime > 5 * 60 * 1000) {
        if (provisionPollRef.current) {
          clearInterval(provisionPollRef.current);
          provisionPollRef.current = null;
        }
        setError('Channel provisioning timed out. Please delete and try again.');
        setState('error');
        return;
      }
      try {
        const { data } = await api.get('/whatsapp/channel-status');
        if (data.status === 'ready') {
          if (provisionPollRef.current) {
            clearInterval(provisionPollRef.current);
            provisionPollRef.current = null;
          }
          setState('qr_display');
          fetchQR();
        }
      } catch {
        // Ignore — keep polling
      }
    }, 5000);
  };

  const fetchQR = async () => {
    try {
      const { data } = await api.get('/whatsapp/create-qr');
      setQrData(data.qr);
      setError(null);
      startHealthPolling();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to load QR code. Please try again.';
      setError(message);
      setState('error');
    }
  };

  const startHealthPolling = () => {
    // Clear health and QR refresh timers (not provision timer)
    if (healthPollRef.current) clearInterval(healthPollRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);

    healthPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/whatsapp/health-check');
        if (data.status === 'connected') {
          clearTimers();
          setChannel((prev) =>
            prev ? { ...prev, channel_status: 'connected', phone_number: data.phone } : prev
          );
          setState('connected');
          toast.success('WhatsApp connected successfully');
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    // Refresh QR every 30s
    qrRefreshRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/whatsapp/create-qr');
        setQrData(data.qr);
      } catch {
        // Ignore
      }
    }, 30000);
  };

  const handleCreateChannel = async () => {
    setState('creating');
    setError(null);
    try {
      await api.post('/whatsapp/create-channel');
      // Channel created on WhAPI but needs up to 90s to provision.
      // Show provisioning state and poll until ready.
      setState('provisioning');
      startProvisionPolling();
    } catch {
      setError('Failed to create channel. Please try again.');
      setState('error');
      toast.error('Failed to create WhatsApp channel');
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/whatsapp/logout');
      clearTimers();
      setChannel((prev) =>
        prev ? { ...prev, channel_status: 'disconnected' } : prev
      );
      setState('qr_display');
      await fetchQR();
      toast.success('WhatsApp disconnected');
    } catch {
      setError('Failed to disconnect.');
      toast.error('Failed to disconnect WhatsApp');
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete('/whatsapp/delete-channel');
      clearTimers();
      setChannel(null);
      setQrData(null);
      setState('no_channel');
      toast.success('Channel deleted');
    } catch {
      setError('Failed to delete channel.');
      toast.error('Failed to delete channel');
    }
  };

  useEffect(() => {
    fetchChannel();
    return clearTimers;
  }, [fetchChannel, clearTimers]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Smartphone className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>WhatsApp Connection</CardTitle>
            <CardDescription>
              Connect your WhatsApp account to start receiving messages
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {state === 'loading' && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-64 w-64" />
          </div>
        )}

        {state === 'no_channel' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              No WhatsApp account connected yet.
            </p>
            <Button onClick={handleCreateChannel}>
              <Smartphone className="mr-2 h-4 w-4" />
              Connect WhatsApp
            </Button>
          </div>
        )}

        {(state === 'creating' || state === 'provisioning') && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {state === 'creating'
                ? 'Creating your channel...'
                : 'Initializing WhatsApp channel. This can take up to 90 seconds...'}
            </p>
            {state === 'provisioning' && (
              <>
                <p className="text-xs text-muted-foreground">
                  Checking every 5 seconds...
                </p>
                <Button variant="outline" size="sm" onClick={handleDelete}>
                  <Trash2 className="mr-2 h-3 w-3" />
                  Cancel & Delete Channel
                </Button>
              </>
            )}
          </div>
        )}

        {state === 'qr_display' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your WhatsApp app
            </p>
            {qrData ? (
              <div className="rounded-lg border bg-white p-4">
                <QRCodeSVG value={qrData} size={256} />
              </div>
            ) : (
              <Skeleton className="h-[288px] w-[288px]" />
            )}
            <p className="text-xs text-muted-foreground">
              QR code refreshes automatically. Checking connection every 5 seconds...
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchQR}>
                <RefreshCw className="mr-2 h-3 w-3" />
                Refresh QR
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete}>
                <Trash2 className="mr-2 h-3 w-3" />
                Delete Channel
              </Button>
            </div>
          </div>
        )}

        {state === 'connected' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <p className="font-medium">Connected</p>
                {channel?.phone_number && (
                  <p className="text-sm text-muted-foreground">
                    {channel.phone_number}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="ml-auto">
                Active
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="mr-2 h-3 w-3" />
                Disconnect
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete}>
                <Trash2 className="mr-2 h-3 w-3" />
                Delete Channel
              </Button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <XCircle className="h-8 w-8 text-destructive" />
            <Button variant="outline" onClick={fetchChannel}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
