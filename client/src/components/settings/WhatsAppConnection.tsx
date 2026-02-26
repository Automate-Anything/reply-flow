import { useState, useCallback, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Smartphone, Loader2, XCircle, RefreshCw, Trash2, Check } from 'lucide-react';
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
  const [elapsed, setElapsed] = useState(0);

  const PROVISIONING_STEPS = [
    { label: 'Preparing environment', duration: 80 },
    { label: 'Creating channel', duration: 80 },
    { label: 'Finalizing setup', duration: 80 },
  ] as const;

  useEffect(() => {
    if (state !== 'creating') {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

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
        timeout: 300_000,
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
      <Card className="border-dashed transition-colors hover:border-primary/40 hover:bg-muted/30">
        <CardContent className="flex items-center gap-4 py-5 px-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Add a new channel</p>
            <p className="text-xs text-muted-foreground">
              Link a WhatsApp number by scanning a QR code
            </p>
          </div>
          <Button size="sm" onClick={handleCreateChannel}>
            Add Channel
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
            <CardTitle>New Channel</CardTitle>
            <CardDescription>
              Link a WhatsApp account by scanning the QR code
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

        {state === 'creating' && (() => {
          let cumulative = 0;
          const totalSeconds = PROVISIONING_STEPS.reduce((s, st) => s + st.duration, 0);
          const overallPct = Math.min((elapsed / totalSeconds) * 100, 95);
          const remaining = Math.max(0, totalSeconds - elapsed);

          return (
            <div className="space-y-6 py-4">
              {/* Stepper */}
              <div className="relative ml-4">
                {PROVISIONING_STEPS.map((step, i) => {
                  const stepStart = cumulative;
                  cumulative += step.duration;
                  const stepElapsed = Math.max(0, elapsed - stepStart);
                  const done = stepElapsed >= step.duration;
                  const active = !done && elapsed >= stepStart;
                  const isLast = i === PROVISIONING_STEPS.length - 1;

                  return (
                    <div key={i} className={`relative flex gap-3 ${isLast ? '' : 'pb-6'}`}>
                      {/* Connector line */}
                      {!isLast && (
                        <div className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5 bg-muted">
                          <div
                            className="w-full bg-primary transition-all duration-1000 ease-linear"
                            style={{ height: done ? '100%' : active ? `${Math.min((stepElapsed / step.duration) * 100, 95)}%` : '0%' }}
                          />
                        </div>
                      )}
                      {/* Step indicator */}
                      <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
                        {done ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3.5 w-3.5" />
                          </div>
                        ) : active ? (
                          <div className="relative flex h-6 w-6 items-center justify-center">
                            <span className="absolute h-6 w-6 animate-ping rounded-full bg-primary/20" />
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          </div>
                        ) : (
                          <div className="h-2.5 w-2.5 rounded-full bg-muted" />
                        )}
                      </div>
                      {/* Label */}
                      <div className="pt-0.5">
                        <p className={`text-sm leading-tight ${active ? 'font-medium text-foreground' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {step.label}
                          {done && <span className="ml-2 text-xs text-muted-foreground">Done</span>}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overall progress bar + time */}
              <div className="space-y-2 px-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {remaining > 0
                      ? remaining >= 60
                        ? `~${Math.ceil(remaining / 60)} min remaining`
                        : 'Less than a minute left'
                      : 'Almost there...'}
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelProvisioning}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

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
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Channel creation failed</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error || 'Something went wrong. Please try again.'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setError(null); setState('idle'); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateChannel}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Try Again
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
