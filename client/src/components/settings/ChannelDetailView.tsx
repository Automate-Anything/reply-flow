import { useState, useCallback, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, WifiOff, QrCode, Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import AIProfileWizard from './AIProfileWizard';
import KnowledgeBase from './KnowledgeBase';
import { useChannelAI } from '@/hooks/useChannelAI';
import type { ChannelInfo } from './channelHelpers';
import { formatChannelName, getStatusConfig, timeAgo } from './channelHelpers';

interface Props {
  channel: ChannelInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'pending':
      return <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />;
    case 'awaiting_scan':
      return <QrCode className="h-5 w-5 text-blue-500" />;
    default:
      return <WifiOff className="h-5 w-5 text-muted-foreground" />;
  }
}

export default function ChannelDetailView({ channel, open, onOpenChange, onUpdate }: Props) {
  const [effectiveStatus, setEffectiveStatus] = useState(channel.channel_status);
  const [qrData, setQrData] = useState<string | null>(null);
  const [loadingQR, setLoadingQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);
  const cancelledRef = useRef(false);

  const {
    profile,
    kbEntries,
    loadingProfile,
    loadingKB,
    updateProfile,
    addKBEntry,
    uploadKBFile,
    updateKBEntry,
    deleteKBEntry,
  } = useChannelAI(channel.id);

  // Sync effectiveStatus when channel prop changes
  useEffect(() => {
    setEffectiveStatus(channel.channel_status);
    setQrData(null);
    setConfirmDelete(false);
  }, [channel.id, channel.channel_status]);

  // Poll health-check when pending
  useEffect(() => {
    if (!open || effectiveStatus !== 'pending') return;

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
  }, [open, effectiveStatus, channel.id, onUpdate]);

  // When awaiting_scan: fetch QR, auto-refresh, poll for connection
  useEffect(() => {
    if (!open || effectiveStatus !== 'awaiting_scan') return;

    let cancelled = false;
    cancelledRef.current = false;

    const handleQRResponse = (data: { qr?: string; connected?: boolean }) => {
      if (cancelled) return;
      if (data.connected) {
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        onUpdate();
        return;
      }
      if (data.qr) setQrData(data.qr);
    };

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

    const qrInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
        handleQRResponse(data);
      } catch {
        // ignore
      }
    }, 30000);

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
  }, [open, effectiveStatus, channel.id, onUpdate]);

  const handleReconnect = useCallback(() => {
    setEffectiveStatus('awaiting_scan');
  }, []);

  const handleRefreshQR = async () => {
    setRefreshingQR(true);
    try {
      const { data } = await api.get(`/whatsapp/create-qr?channelId=${channel.id}`);
      if (data.connected) {
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        onUpdate();
      } else {
        setQrData(data.qr);
      }
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
      onOpenChange(false);
      onUpdate();
    } catch {
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleAI = async () => {
    setToggling(true);
    try {
      await updateProfile({ is_enabled: !profile.is_enabled });
      toast.success(profile.is_enabled ? 'AI agent disabled' : 'AI agent enabled');
    } catch {
      toast.error('Failed to toggle AI');
    } finally {
      setToggling(false);
    }
  };

  const isConnected = effectiveStatus === 'connected';
  const isProvisioning = effectiveStatus === 'pending';
  const isAwaitingScan = effectiveStatus === 'awaiting_scan';
  const isDisconnected = effectiveStatus === 'disconnected';
  const statusConfig = getStatusConfig(effectiveStatus);
  const displayName = formatChannelName(channel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${statusConfig.iconBg}`}>
              {getStatusIcon(effectiveStatus)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate">{displayName}</DialogTitle>
                <Badge variant="outline" className={`shrink-0 ${statusConfig.badgeClass}`}>
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
                  {statusConfig.label}
                </Badge>
              </div>
              <DialogDescription>
                Created {timeAgo(channel.created_at)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Channel details */}
          <div className="grid gap-3 rounded-lg border p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone Number</span>
              <span className="font-medium">{channel.phone_number || 'Not connected'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Channel Name</span>
              <span className="font-medium truncate ml-4">{channel.channel_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Webhook</span>
              <span className="font-medium">{channel.webhook_registered ? 'Registered' : 'Not registered'}</span>
            </div>
          </div>

          {/* Provisioning state */}
          {isProvisioning && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
              <div>
                <p className="text-sm font-medium">Setting up channel...</p>
                <p className="text-xs text-muted-foreground">This may take a few minutes.</p>
              </div>
            </div>
          )}

          {/* QR code display */}
          {isAwaitingScan && (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-blue-500/30 bg-muted/30 p-5">
              <p className="text-sm font-medium">Scan this QR code with your WhatsApp app</p>
              {loadingQR ? (
                <Skeleton className="h-[232px] w-[232px] rounded-lg" />
              ) : qrData ? (
                <div className="rounded-lg border bg-white p-3 shadow-sm">
                  <QRCodeSVG value={qrData} size={200} />
                </div>
              ) : (
                <div className="flex h-[232px] w-[232px] items-center justify-center rounded-lg border bg-muted/50">
                  <p className="text-sm text-muted-foreground">Failed to load QR code</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                QR code refreshes automatically. Checking connection every 5s...
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {isConnected && (
              <Button variant="outline" size="sm" onClick={handleLogout} disabled={disconnecting || deleting}>
                {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <LogOut className="mr-2 h-3.5 w-3.5" />}
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            )}
            {isDisconnected && (
              <Button variant="outline" size="sm" onClick={handleReconnect}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Reconnect
              </Button>
            )}
            {isAwaitingScan && (
              <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={refreshingQR}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshingQR ? 'animate-spin' : ''}`} />
                {refreshingQR ? 'Refreshing...' : 'Refresh QR'}
              </Button>
            )}

            {!isProvisioning && (
              <div className="ml-auto">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Delete?</span>
                    <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
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
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* AI Settings Section */}
          <div className="border-t pt-5">
            {/* AI toggle */}
            <div className="flex items-center gap-3 mb-4">
              <Bot className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">AI Agent</p>
                <p className="text-xs text-muted-foreground">
                  Configure the AI assistant for this channel
                </p>
              </div>
              <button
                onClick={handleToggleAI}
                disabled={toggling || loadingProfile}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  toggling || loadingProfile ? 'cursor-wait opacity-60' : 'cursor-pointer'
                } ${profile.is_enabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    profile.is_enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                >
                  {toggling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </span>
              </button>
            </div>

            {loadingProfile ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="profile">
                <TabsList className="w-full">
                  <TabsTrigger value="profile">AI Profile</TabsTrigger>
                  <TabsTrigger value="knowledge-base">Knowledge Base</TabsTrigger>
                </TabsList>
                <TabsContent value="profile">
                  <AIProfileWizard profile={profile} onSave={updateProfile} />
                </TabsContent>
                <TabsContent value="knowledge-base">
                  <KnowledgeBase
                    entries={kbEntries}
                    onAdd={addKBEntry}
                    onUpload={uploadKBFile}
                    onUpdate={updateKBEntry}
                    onDelete={deleteKBEntry}
                    loading={loadingKB}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
