import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, WifiOff, QrCode,
  Bot, ArrowLeft, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChannelAgent } from '@/hooks/useChannelAgent';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import { useAgents } from '@/hooks/useAgents';
import KBAssignmentList from './KBAssignmentList';
import ScheduleSection from './sections/ScheduleSection';
import type { ScheduleMode } from '@/hooks/useCompanyAI';
import type { BusinessHours } from './BusinessHoursEditor';
import type { ChannelInfo } from './channelHelpers';
import { formatChannelName, getStatusConfig, timeAgo } from './channelHelpers';

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

export default function ChannelDetailPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const numericChannelId = Number(channelId);

  // Channel data
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [effectiveStatus, setEffectiveStatus] = useState('');
  const [qrData, setQrData] = useState<string | null>(null);
  const [loadingQR, setLoadingQR] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelledRef = useRef(false);

  // AI settings
  const {
    settings,
    loadingSettings,
    updateSettings,
  } = useChannelAgent(numericChannelId);

  // Agents list for assignment dropdown
  const { agents, loading: loadingAgents } = useAgents();

  // Company KB data
  const { kbEntries, loading: loadingKB } = useCompanyKB();

  // Company timezone (still company-level)
  const [companyTimezone, setCompanyTimezone] = useState('UTC');

  // AI toggle state
  const [toggling, setToggling] = useState(false);

  // Fetch channel data
  const fetchChannel = useCallback(async () => {
    try {
      const { data } = await api.get(`/whatsapp/channels/${numericChannelId}`);
      setChannel(data.channel);
      setEffectiveStatus(data.channel.channel_status);
    } catch {
      toast.error('Failed to load channel');
      navigate('/channels');
    } finally {
      setLoadingChannel(false);
    }
  }, [numericChannelId, navigate]);

  // Fetch company timezone
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/company');
        setCompanyTimezone(data.company.timezone || 'UTC');
      } catch {
        // Ignore — use defaults
      }
    })();
  }, []);

  useEffect(() => {
    fetchChannel();
  }, [fetchChannel]);

  // Poll health-check when pending
  useEffect(() => {
    if (effectiveStatus !== 'pending') return;

    const poll = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${numericChannelId}`);
        if (data.status !== 'pending') {
          setEffectiveStatus(data.status);
          if (data.status === 'connected') {
            toast.success('WhatsApp connected successfully');
            fetchChannel();
          }
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [effectiveStatus, numericChannelId, fetchChannel]);

  // When awaiting_scan: fetch QR, auto-refresh, poll for connection
  useEffect(() => {
    if (effectiveStatus !== 'awaiting_scan') return;

    let cancelled = false;
    cancelledRef.current = false;

    const handleQRResponse = (data: { qr?: string; connected?: boolean }) => {
      if (cancelled) return;
      if (data.connected) {
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        fetchChannel();
        return;
      }
      if (data.qr) setQrData(data.qr);
    };

    const fetchQR = async () => {
      setLoadingQR(true);
      try {
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${numericChannelId}`);
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
        const { data } = await api.get(`/whatsapp/create-qr?channelId=${numericChannelId}`);
        handleQRResponse(data);
      } catch {
        // ignore
      }
    }, 30000);

    const healthInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${numericChannelId}`);
        if (data.status === 'connected' && !cancelled) {
          setEffectiveStatus('connected');
          setQrData(null);
          toast.success('WhatsApp connected successfully');
          fetchChannel();
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
  }, [effectiveStatus, numericChannelId, fetchChannel]);

  const handleReconnect = useCallback(() => {
    setEffectiveStatus('awaiting_scan');
  }, []);

  const handleRefreshQR = async () => {
    setRefreshingQR(true);
    try {
      const { data } = await api.get(`/whatsapp/create-qr?channelId=${numericChannelId}`);
      if (data.connected) {
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        fetchChannel();
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
      await api.post('/whatsapp/logout', { channelId: numericChannelId });
      toast.success('WhatsApp disconnected');
      fetchChannel();
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
      await api.delete('/whatsapp/delete-channel', { data: { channelId: numericChannelId } });
      toast.success('Channel deleted');
      navigate('/channels');
    } catch {
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleAI = async () => {
    setToggling(true);
    try {
      await updateSettings({ is_enabled: !settings.is_enabled });
      toast.success(settings.is_enabled ? 'AI disabled for this channel' : 'AI enabled for this channel');
    } catch {
      toast.error('Failed to toggle AI');
    } finally {
      setToggling(false);
    }
  };

  const handleAgentChange = async (agentId: string) => {
    try {
      await updateSettings({ agent_id: agentId === '__none__' ? null : agentId });
      toast.success(agentId === '__none__' ? 'Agent unassigned' : 'Agent assigned');
    } catch {
      toast.error('Failed to update agent assignment');
    }
  };

  const handleSaveSchedule = async (updates: {
    business_hours: BusinessHours;
    schedule_mode: ScheduleMode;
    ai_schedule: BusinessHours | null;
    outside_hours_message: string | null;
  }) => {
    await updateSettings(updates);
    toast.success('Schedule saved');
  };

  // Schedule section toggle
  const [scheduleExpanded, setScheduleExpanded] = useState(false);

  if (loadingChannel) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!channel) return null;

  const isConnected = effectiveStatus === 'connected';
  const isProvisioning = effectiveStatus === 'pending';
  const isAwaitingScan = effectiveStatus === 'awaiting_scan';
  const isDisconnected = effectiveStatus === 'disconnected';
  const statusConfig = getStatusConfig(effectiveStatus);
  const displayName = formatChannelName(channel);
  const assignedAgent = agents.find((a) => a.id === settings.agent_id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/channels')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${statusConfig.iconBg}`}>
          {getStatusIcon(effectiveStatus)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{displayName}</h2>
            <Badge variant="outline" className={`shrink-0 ${statusConfig.badgeClass}`}>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
              {statusConfig.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Created {timeAgo(channel.created_at)}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="ai-agent">
        <TabsList className="w-full">
          <TabsTrigger value="connection" className="flex-1">Connection</TabsTrigger>
          <TabsTrigger value="ai-agent" className="flex-1">AI Agent</TabsTrigger>
          <TabsTrigger value="knowledge-base" className="flex-1">Knowledge Base</TabsTrigger>
        </TabsList>

        {/* Connection Tab */}
        <TabsContent value="connection" className="space-y-5">
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
        </TabsContent>

        {/* AI Agent Tab */}
        <TabsContent value="ai-agent" className="space-y-5">
          {/* AI Toggle */}
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">AI Agent</p>
              <p className="text-xs text-muted-foreground">
                {settings.is_enabled ? 'AI is responding on this channel' : 'AI is disabled for this channel'}
              </p>
            </div>
            <button
              onClick={handleToggleAI}
              disabled={toggling || loadingSettings}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                toggling || loadingSettings ? 'cursor-wait opacity-60' : 'cursor-pointer'
              } ${settings.is_enabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span
                className={`pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  settings.is_enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              >
                {toggling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </span>
            </button>
          </div>

          {settings.is_enabled && (
            <div className="space-y-5">
              {/* Agent Assignment */}
              <div className="space-y-2">
                <Label className="text-xs">Assigned Agent</Label>
                {loadingAgents ? (
                  <Skeleton className="h-20 w-full rounded-lg" />
                ) : agents.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center">
                    <Bot className="mx-auto h-6 w-6 text-muted-foreground/40" />
                    <p className="mt-1 text-xs text-muted-foreground">No agents created yet.</p>
                    <Button size="sm" variant="outline" className="mt-2" asChild>
                      <Link to="/ai-agents">
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Create an Agent
                      </Link>
                    </Button>
                  </div>
                ) : assignedAgent ? (
                  /* Assigned agent card */
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {assignedAgent.name}
                        </p>
                        <p className="text-xs text-muted-foreground">Handles all AI replies on this channel</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-8 text-xs" asChild>
                          <Link to={`/ai-agents/${assignedAgent.id}`}>Edit</Link>
                        </Button>
                        <Select
                          value={assignedAgent.id}
                          onValueChange={handleAgentChange}
                        >
                          <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:text-foreground">
                            <SelectValue>Change</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              <span className="text-muted-foreground">No agent</span>
                            </SelectItem>
                            {agents.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* No agent assigned — prompt to pick one */
                  <div className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-muted-foreground">No agent assigned</p>
                        <p className="text-xs text-muted-foreground">AI is enabled but has no personality configured</p>
                      </div>
                      <Select
                        value="__none__"
                        onValueChange={handleAgentChange}
                      >
                        <SelectTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 shrink-0">
                            Assign Agent
                          </Button>
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* Schedule */}
              {loadingSettings ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <ScheduleSection
                  businessHours={settings.business_hours}
                  scheduleMode={settings.schedule_mode}
                  aiSchedule={settings.ai_schedule}
                  outsideHoursMessage={settings.outside_hours_message}
                  companyTimezone={companyTimezone}
                  isExpanded={scheduleExpanded}
                  onToggle={() => setScheduleExpanded((prev) => !prev)}
                  onSave={handleSaveSchedule}
                />
              )}
            </div>
          )}
        </TabsContent>

        {/* Knowledge Base Tab */}
        <TabsContent value="knowledge-base">
          <KBAssignmentList
            channelId={numericChannelId}
            kbEntries={kbEntries}
            loadingKB={loadingKB}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
