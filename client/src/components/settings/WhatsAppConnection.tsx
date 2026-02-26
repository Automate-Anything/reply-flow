import { useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Smartphone, Loader2, XCircle, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type ConnectionState = 'idle' | 'creating' | 'qr_display' | 'error';

interface Props {
  onCreated: () => void;
}

export default function WhatsAppConnection({ onCreated }: Props) {
  const [state, setState] = useState<ConnectionState>('idle');
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dbChannelId, setDbChannelId] = useState<number | null>(null);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);

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

  const fetchQR = async (channelId: number) => {
    try {
      const { data } = await api.get(`/whatsapp/create-qr?channelId=${channelId}`);
      setQrData(data.qr);
      setError(null);
      startHealthPolling(channelId);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to load QR code. Please try again.';
      setError(message);
      setState('error');
    }
  };

  const startHealthPolling = (channelId: number) => {
    if (healthPollRef.current) clearInterval(healthPollRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);

    healthPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${channelId}`);
        if (data.status === 'connected') {
          clearTimers();
          setState('idle');
          setQrData(null);
          setDbChannelId(null);
          toast.success('WhatsApp connected successfully');
          onCreated();
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    // Refresh QR every 30s
    qrRefreshRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${channelId}`);
        setQrData(data.qr);
      } catch {
        // Ignore
      }
    }, 30000);
  };

  const handleCreateChannel = async () => {
    setState('creating');
    setError(null);
    const controller = new AbortController();
    createAbortRef.current = controller;
    try {
      const { data } = await api.post('/whatsapp/create-channel', null, {
        timeout: 150_000,
        signal: controller.signal,
      });
      setDbChannelId(data.dbChannelId);
      setQrData(data.qr);
      setState('qr_display');
      startHealthPolling(data.dbChannelId);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError('Failed to create channel. Please try again.');
      setState('error');
      toast.error('Failed to create WhatsApp channel');
    } finally {
      createAbortRef.current = null;
    }
  };

  const handleCancelProvisioning = async () => {
    createAbortRef.current?.abort();
    createAbortRef.current = null;
    try {
      if (dbChannelId) {
        await api.post('/whatsapp/cancel-provisioning', { channelId: dbChannelId });
      }
    } catch {
      // Best-effort
    }
    clearTimers();
    setQrData(null);
    setDbChannelId(null);
    setState('idle');
    toast.success('Channel creation cancelled');
  };

  const handleDelete = async () => {
    if (!dbChannelId) return;
    setDeleting(true);
    try {
      await api.delete('/whatsapp/delete-channel', { data: { channelId: dbChannelId } });
      clearTimers();
      setQrData(null);
      setDbChannelId(null);
      setState('idle');
      toast.success('Channel deleted');
    } catch {
      setError('Failed to delete channel.');
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  };

  const handleRefreshQR = async () => {
    if (!dbChannelId) return;
    setRefreshingQR(true);
    try {
      await fetchQR(dbChannelId);
    } finally {
      setRefreshingQR(false);
    }
  };

  // Idle state — show "Add Channel" button
  if (state === 'idle') {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <p className="text-sm text-muted-foreground">
            Connect a new WhatsApp account
          </p>
          <Button onClick={handleCreateChannel}>
            <Smartphone className="mr-2 h-4 w-4" />
            Add WhatsApp Channel
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Smartphone className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>New WhatsApp Channel</CardTitle>
            <CardDescription>
              Connect a new WhatsApp account
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

        {state === 'creating' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Creating and provisioning your channel. This can take up to 90 seconds...
            </p>
            <Button variant="outline" size="sm" onClick={handleCancelProvisioning}>
              <XCircle className="mr-2 h-3 w-3" />
              Cancel
            </Button>
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
              <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={refreshingQR}>
                <RefreshCw className={`mr-2 h-3 w-3 ${refreshingQR ? 'animate-spin' : ''}`} />
                {refreshingQR ? 'Refreshing...' : 'Refresh QR'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Trash2 className="mr-2 h-3 w-3" />}
                {deleting ? 'Deleting...' : 'Delete Channel'}
              </Button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <XCircle className="h-8 w-8 text-destructive" />
            <Button variant="outline" onClick={handleCreateChannel}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
