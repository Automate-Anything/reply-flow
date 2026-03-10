import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
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
  Loader2, CheckCircle2, RefreshCw, Trash2, LogOut, CircleX, QrCode,
  Bot, ArrowLeft, Plus, AlertCircle, Lock, Globe, Users, Eye, Pencil,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { PlanGate } from '@/components/auth/PlanGate';
import { useChannelAgent, type ChannelAgentSettings } from '@/hooks/useChannelAgent';
import { useAgents } from '@/hooks/useAgents';
import { useChannelAccess } from '@/hooks/useAccessControl';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import ScheduleSection from './sections/ScheduleSection';
import type { ScheduleMode } from '@/hooks/useCompanyAI';
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
      return <CircleX className="h-5 w-5 text-destructive" />;
  }
}

export default function ChannelDetailPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const numericChannelId = Number(channelId);

  const activeTab = searchParams.get('tab') || 'connection';
  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

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

  // Access control
  const channelAccess = useChannelAccess(numericChannelId);
  const { members: teamMembers } = useTeamMembers();

  // Company timezone (still company-level)
  const [companyTimezone, setCompanyTimezone] = useState('UTC');

  // AI toggle state
  const [toggling, setToggling] = useState(false);

  // Fetch channel data
  const fetchChannel = useCallback(async (skipStatusUpdate = false) => {
    try {
      const { data } = await api.get(`/whatsapp/channels/${numericChannelId}`);
      setChannel(data.channel);
      if (!skipStatusUpdate) {
        setEffectiveStatus(data.channel.channel_status);
      }
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

  // Verify status with provider when channel appears connected
  useEffect(() => {
    if (effectiveStatus !== 'connected') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${numericChannelId}`);
        if (!cancelled && data.status !== 'connected') {
          setEffectiveStatus(data.status);
          fetchChannel();
        }
      } catch {
        // ignore — keep showing DB status
      }
    })();
    return () => { cancelled = true; };
  }, [numericChannelId, effectiveStatus, fetchChannel]);

  // Poll health-check when pending
  useEffect(() => {
    if (effectiveStatus !== 'pending') return;

    let done = false;
    const poll = setInterval(async () => {
      if (done) return;
      try {
        const { data } = await api.get(`/whatsapp/health-check?channelId=${numericChannelId}`);
        if (data.status !== 'pending') {
          done = true;
          setEffectiveStatus(data.status);
          if (data.status === 'connected') {
            toast.success('WhatsApp connected successfully');
            fetchChannel(true);
          }
        }
      } catch {
        // ignore
      }
    }, 5000);

    return () => { done = true; clearInterval(poll); };
  }, [effectiveStatus, numericChannelId, fetchChannel]);

  // When awaiting_scan: fetch QR, auto-refresh, poll for connection
  useEffect(() => {
    if (effectiveStatus !== 'awaiting_scan') return;

    let cancelled = false;
    cancelledRef.current = false;

    const handleQRResponse = (data: { qr?: string; connected?: boolean }) => {
      if (cancelled) return;
      if (data.connected) {
        cancelled = true;
        cancelledRef.current = true;
        setEffectiveStatus('connected');
        setQrData(null);
        toast.success('WhatsApp connected successfully');
        fetchChannel(true);
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
          cancelled = true;
          cancelledRef.current = true;
          setEffectiveStatus('connected');
          setQrData(null);
          toast.success('WhatsApp connected successfully');
          fetchChannel(true);
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
    schedule_mode: ScheduleMode;
    ai_schedule: ChannelAgentSettings['ai_schedule'];
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
          <p className="text-sm text-muted-foreground">
            {channel.phone_number && <>{channel.phone_number} · </>}
            Created {timeAgo(channel.created_at)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="connection" className="flex-1">Connection</TabsTrigger>
          <TabsTrigger value="ai-agent" className="flex-1">AI Agent</TabsTrigger>
          {channel.is_owner && (
            <TabsTrigger value="access" className="flex-1">
              <Lock className="mr-1.5 h-3.5 w-3.5" />
              Access
            </TabsTrigger>
          )}
        </TabsList>

        {/* Connection Tab */}
        <TabsContent value="connection" className="space-y-5">
          {/* Disconnected banner */}
          {isDisconnected && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="text-sm font-medium">Channel disconnected</p>
                <p className="text-xs text-muted-foreground">
                  This WhatsApp channel is no longer connected. Reconnect to resume messaging.
                </p>
              </div>
              <PlanGate>
                <Button size="sm" onClick={handleReconnect}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Reconnect
                </Button>
              </PlanGate>
            </div>
          )}

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
          {(isConnected || isAwaitingScan) && (
            <div className="flex flex-wrap items-center gap-2">
              {isConnected && (
                <PlanGate>
                  <Button variant="outline" size="sm" onClick={handleLogout} disabled={disconnecting || deleting}>
                    {disconnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <LogOut className="mr-2 h-3.5 w-3.5" />}
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </Button>
                </PlanGate>
              )}
              {isAwaitingScan && (
                <PlanGate>
                  <Button variant="outline" size="sm" onClick={handleRefreshQR} disabled={refreshingQR}>
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshingQR ? 'animate-spin' : ''}`} />
                    {refreshingQR ? 'Refreshing...' : 'Refresh QR'}
                  </Button>
                </PlanGate>
              )}
            </div>
          )}

          {/* Danger zone — Delete */}
          {(
            <div className="rounded-lg border border-dashed border-destructive/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Delete channel</p>
                  <p className="text-xs text-muted-foreground">Permanently remove this channel and all its data.</p>
                </div>
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <PlanGate>
                      <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                        {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                        {deleting ? 'Deleting...' : 'Confirm'}
                      </Button>
                    </PlanGate>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <PlanGate>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(true)}
                      disabled={deleting || disconnecting}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </PlanGate>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* AI Agent Tab */}
        <TabsContent value="ai-agent" className="mt-2 space-y-5">
          {/* AI Toggle */}
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">AI Agent</p>
              <p className="text-xs text-muted-foreground">
                {settings.is_enabled ? 'AI is responding on this channel' : 'AI is disabled for this channel'}
              </p>
            </div>
            <PlanGate>
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
            </PlanGate>
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
                          <Link to={`/ai-agents/${assignedAgent.id}?from=channel&channelId=${numericChannelId}`}>Edit</Link>
                        </Button>
                        <Select
                          value={assignedAgent.id}
                          onValueChange={handleAgentChange}
                        >
                          <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:text-foreground">
                            <SelectValue>Change</SelectValue>
                          </SelectTrigger>
                          <SelectContent position="popper" side="bottom" sideOffset={4}>
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
                        <SelectTrigger size="sm" className="h-8 w-auto shrink-0">
                          <SelectValue>Assign Agent</SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper" side="bottom" sideOffset={4}>
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

        {/* Access Tab — only visible to channel owner */}
        {channel.is_owner && channelAccess.settings && (
          <TabsContent value="access" className="mt-2 space-y-5">
            {/* Who has access */}
            <div>
              <h3 className="text-sm font-medium mb-1">Who has access to this channel</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Controls who can see conversations and messages in this channel.
                This is separate from assignment — assigning determines who is responsible for responding.
              </p>
              <div className="space-y-2">
                {([
                  { value: 'private' as const, label: 'Private', desc: 'Only you can see this channel', icon: Lock },
                  { value: 'specific_users' as const, label: 'Specific people', desc: 'Only people you choose', icon: Users },
                  { value: 'all_members' as const, label: 'All team members', desc: 'Everyone on the team', icon: Globe },
                ] as const).map((option) => {
                  const Icon = option.icon;
                  const isActive = channelAccess.settings!.sharing_mode === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={async () => {
                        try {
                          await channelAccess.updateSettings({ sharing_mode: option.value });
                          toast.success(`Access updated to: ${option.label}`);
                        } catch {
                          toast.error('Failed to update access');
                        }
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </div>
                      {isActive && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>

              {/* People with access — inline under sharing mode when specific_users */}
              {channelAccess.settings!.sharing_mode === 'specific_users' && (
                <div className="mt-3 space-y-2">
                  <h3 className="text-sm font-medium">People with access</h3>

                  {/* Owner row — always first, not editable */}
                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{channelAccess.settings!.owner.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{channelAccess.settings!.owner.email}</div>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      <Shield className="mr-1 h-2.5 w-2.5" /> Owner
                    </Badge>
                  </div>

                  {/* Other users with access */}
                  {channelAccess.settings!.access_list.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{entry.user?.full_name || 'Unknown'}</div>
                        <div className="truncate text-xs text-muted-foreground">{entry.user?.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={entry.access_level}
                          onValueChange={async (value) => {
                            try {
                              await channelAccess.grantAccess(entry.user_id, value as 'view' | 'edit');
                              toast.success(`Access updated to ${value}`);
                            } catch {
                              toast.error('Failed to update access');
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view">
                              <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> Can view</span>
                            </SelectItem>
                            <SelectItem value="edit">
                              <span className="flex items-center gap-1"><Pencil className="h-3 w-3" /> Can edit</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={async () => {
                            try {
                              await channelAccess.revokeAccess(entry.user_id);
                              toast.success('Access revoked');
                            } catch {
                              toast.error('Failed to revoke access');
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Add member */}
                  {(() => {
                    const availableMembers = teamMembers.filter(
                      (m) => m.user_id !== channel.user_id && !channelAccess.settings!.access_list.some((a) => a.user_id === m.user_id)
                    );
                    if (availableMembers.length === 0) return null;
                    return (
                      <div className="pt-2 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Add team members</p>
                        <div className="space-y-1">
                          {availableMembers.map((member) => (
                            <div key={member.user_id} className="flex items-center justify-between rounded-lg border border-dashed p-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm">{member.full_name}</div>
                                <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={async () => {
                                    try {
                                      await channelAccess.grantAccess(member.user_id, 'view');
                                      toast.success(`View access granted to ${member.full_name}`);
                                    } catch {
                                      toast.error('Failed to grant access');
                                    }
                                  }}
                                >
                                  <Eye className="mr-1 h-3 w-3" /> View
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={async () => {
                                    try {
                                      await channelAccess.grantAccess(member.user_id, 'edit');
                                      toast.success(`Edit access granted to ${member.full_name}`);
                                    } catch {
                                      toast.error('Failed to grant access');
                                    }
                                  }}
                                >
                                  <Pencil className="mr-1 h-3 w-3" /> Edit
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Conversation visibility default — only relevant when sharing */}
            {channelAccess.settings.sharing_mode !== 'private' && <div>
              <h3 className="text-sm font-medium mb-1">Default conversation visibility</h3>
              <p className="text-xs text-muted-foreground mb-3">
                When someone has access to this channel, can they see all conversations or only ones you specifically grant?
              </p>
              <div className="space-y-2">
                {([
                  { value: 'all' as const, label: 'All conversations', desc: 'Shared users see every conversation', icon: Eye },
                  { value: 'owner_only' as const, label: 'Only granted conversations', desc: 'Conversations are private until you grant access to each one', icon: Lock },
                ] as const).map((option) => {
                  const Icon = option.icon;
                  const isActive = channelAccess.settings!.default_conversation_visibility === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={async () => {
                        try {
                          await channelAccess.updateSettings({ default_conversation_visibility: option.value });
                          toast.success(`Conversation visibility updated`);
                        } catch {
                          toast.error('Failed to update');
                        }
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </div>
                      {isActive && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>}
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
}
