import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, WifiOff, QrCode, Bot, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import ChannelAgentSettings from './ChannelAgentSettings';
import KBAssignmentList from './KBAssignmentList';
import { useCompanyKB } from '@/hooks/useCompanyKB';
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
  const navigate = useNavigate();
  const [effectiveStatus, setEffectiveStatus] = useState(channel.channel_status);
  const [qrData, setQrData] = useState<string | null>(null);
  const [loadingQR, setLoadingQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelledRef = useRef(false);

  // Company KB data for KB assignment list
  const { kbEntries, loading: loadingKB } = useCompanyKB();

  // Sync state when channel prop changes
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

          {/* Agent Settings + KB Assignments */}
          <div className="border-t pt-5">
            <div className="flex items-center gap-3 mb-4">
              <Bot className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">AI Configuration</p>
                <p className="text-xs text-muted-foreground">
                  Configure agent settings and knowledge base assignments for this channel.
                </p>
              </div>
              {channel.workspace_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/workspaces/${channel.workspace_id}`);
                  }}
                >
                  Workspace <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>

            <Tabs defaultValue="agent-settings">
              <TabsList className="w-full">
                <TabsTrigger value="agent-settings" className="flex-1">Agent Settings</TabsTrigger>
                <TabsTrigger value="kb-assignments" className="flex-1">KB Assignments</TabsTrigger>
              </TabsList>
              <TabsContent value="agent-settings">
                <ChannelAgentSettings channelId={channel.id} hasWorkspace={true} />
              </TabsContent>
              <TabsContent value="kb-assignments">
                <KBAssignmentList
                  channelId={channel.id}
                  hasWorkspace={true}
                  workspaceKBEntries={kbEntries}
                  loadingKB={loadingKB}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
