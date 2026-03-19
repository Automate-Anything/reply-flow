import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
  Bot, ArrowLeft, Plus, AlertCircle, Lock, Globe, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { PlanGate } from '@/components/auth/PlanGate';
import { useChannelAgent, type ChannelAgentSettings } from '@/hooks/useChannelAgent';
import { useAgents } from '@/hooks/useAgents';
import { useChannelPermissions } from '@/hooks/usePermissions';
import type { AccessLevel, PermissionConflict, ConflictResolution } from '@/hooks/usePermissions';
import ConflictResolutionModal from '@/components/access/ConflictResolutionModal';
import AccessManager from '@/components/access/AccessManager';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import ScheduleSection from './sections/ScheduleSection';
import AutoReplySection from './sections/AutoReplySection';
import ComplianceTab from './sections/ComplianceTab';
import ChannelAgentContactList from './ChannelAgentContactList';
import type { ScheduleMode } from '@/hooks/useCompanyAI';
import type { ChannelInfo } from './channelHelpers';
import { formatChannelName, formatPhoneDisplay, getStatusConfig, timeAgo } from './channelHelpers';

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
    refetchSettings,
  } = useChannelAgent(numericChannelId);

  // Agents list for assignment dropdown
  const { agents, loading: loadingAgents } = useAgents();

  // Access control (new 4-level permissions)
  const {
    settings: permissionSettings,
    grantAccess,
    revokeAccess,
    checkConflicts,
    resolveConflicts,
  } = useChannelPermissions(numericChannelId);
  const { members: teamMembers } = useTeamMembers();

  // Conflict resolution state
  const [conflicts, setConflicts] = useState<PermissionConflict[]>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<Record<string, unknown> | null>(null);

  const handleChannelModeChange = async (newMode: string, level?: AccessLevel) => {
    // Determine what changes are being made
    const proposedChange: Record<string, unknown> = {};
    if (permissionSettings?.mode === 'all_members' && newMode !== 'all_members') {
      proposedChange.removeAllMembersRow = true;
    }

    // Check for conflicts
    const detected = await checkConflicts(proposedChange);
    if (detected.length > 0) {
      setConflicts(detected);
      setPendingChange(proposedChange);
      setConflictModalOpen(true);
      return;
    }

    // No conflicts — apply directly
    if (newMode === 'all_members') {
      await grantAccess('all', level || 'view');
    } else if (newMode === 'private') {
      await revokeAccess('all');
    }
    // For specific_users, mode change handled by revoking 'all' if needed
    if (newMode === 'specific_users' && permissionSettings?.mode === 'all_members') {
      await revokeAccess('all');
    }
  };

  const handleResolveConflicts = async (resolutions: ConflictResolution[]) => {
    if (!pendingChange) return;
    await resolveConflicts(pendingChange, resolutions);
    setPendingChange(null);
  };

  // Company timezone (still company-level)
  const [companyTimezone, setCompanyTimezone] = useState('UTC');

  // AI toggle state
  const [toggling, setToggling] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [modeListOpen, setModeListOpen] = useState(false);

  // Fetch channel data
  const fetchChannel = useCallback(async (skipStatusUpdate = false) => {
    try {
      const { data } = await api.get(`/channels/whatsapp/channels/${numericChannelId}`);
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
  // Also re-fetches channel data so server-synced metadata (phone number, profile) is picked up
  useEffect(() => {
    if (effectiveStatus !== 'connected') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/channels/whatsapp/health-check?channelId=${numericChannelId}`);
        if (cancelled) return;
        if (data.status !== 'connected') {
          setEffectiveStatus(data.status);
        }
        // Always re-fetch — the health check may have synced missing metadata
        fetchChannel(true);
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
        const { data } = await api.get(`/channels/whatsapp/health-check?channelId=${numericChannelId}`);
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
        const { data } = await api.get(`/channels/whatsapp/create-qr?channelId=${numericChannelId}`);
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
        const { data } = await api.get(`/channels/whatsapp/create-qr?channelId=${numericChannelId}`);
        handleQRResponse(data);
      } catch {
        // ignore
      }
    }, 30000);

    const healthInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/channels/whatsapp/health-check?channelId=${numericChannelId}`);
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
      const { data } = await api.get(`/channels/whatsapp/create-qr?channelId=${numericChannelId}`);
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
      await api.post('/channels/whatsapp/logout', { channelId: numericChannelId });
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
      await api.delete('/channels/whatsapp/delete-channel', { data: { channelId: numericChannelId } });
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
  }) => {
    await updateSettings(updates);
    await refetchSettings();
    setScheduleExpanded(false);
    toast.success('Schedule saved');
  };

  // Schedule section toggle
  const [scheduleExpanded, setScheduleExpanded] = useState(false);

  // Auto-reply section toggle
  const [autoReplyExpanded, setAutoReplyExpanded] = useState(false);

  const handleSaveAutoReply = async (updates: {
    auto_reply_enabled: boolean;
    auto_reply_message: string | null;
    auto_reply_messages: string[];
    auto_reply_trigger: 'outside_hours' | 'all_unavailable';
  }) => {
    await updateSettings(updates);
    await refetchSettings();
    setAutoReplyExpanded(false);
    toast.success('Auto-reply settings saved');
  };

  const handleResponseModeChange = async (mode: ChannelAgentSettings['response_mode']) => {
    setSavingMode(true);
    try {
      await updateSettings({ response_mode: mode });
      setModeListOpen(true);
      toast.success(mode === 'test' ? 'AI set to test mode' : 'AI set to live mode');
    } catch {
      toast.error('Failed to update AI mode');
    } finally {
      setSavingMode(false);
    }
  };

  const handleTestContactsChange = async (ids: string[]) => {
    try {
      await updateSettings({ test_contact_ids: ids });
      toast.success('Test contacts updated');
    } catch {
      toast.error('Failed to update test contacts');
      throw new Error('Failed to update test contacts');
    }
  };

  const handleExcludedContactsChange = async (ids: string[]) => {
    try {
      await updateSettings({ excluded_contact_ids: ids });
      toast.success('Excluded contacts updated');
    } catch {
      toast.error('Failed to update excluded contacts');
      throw new Error('Failed to update excluded contacts');
    }
  };

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
  const isTestMode = settings.response_mode === 'test';
  const modeConfig = isTestMode
    ? {
        label: 'Test Mode',
        summary: 'Use this to validate behavior safely before going fully live.',
        detail: 'Any phone number not on the test list will never get an AI reply.',
        icon: AlertCircle,
        badgeClass: 'border-amber-300 bg-amber-50 text-amber-700',
        panelClass: 'border-amber-200/80 bg-linear-to-br from-amber-50 to-background',
        activeButtonClass: 'bg-amber-100 text-amber-800 shadow-sm',
      }
    : {
        label: 'Live Mode',
        summary: 'AI responds normally, except contacts on the exclude list.',
        detail: 'Use the exclude list for people who should always stay with a human.',
        icon: Globe,
        badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700',
        panelClass: 'border-emerald-200/80 bg-linear-to-br from-emerald-50 to-background',
        activeButtonClass: 'bg-emerald-100 text-emerald-800 shadow-sm',
      };
  const ModeIcon = modeConfig.icon;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-6 pt-4">
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
            <h2 className="truncate text-lg font-semibold">{channel.profile_name || displayName}</h2>
            <Badge variant="outline" className={`shrink-0 ${statusConfig.badgeClass}`}>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
              {statusConfig.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {channel.phone_number && (
              <>{formatPhoneDisplay(channel.phone_number)} · </>
            )}
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
          <TabsTrigger value="compliance" className="flex-1">Compliance</TabsTrigger>
        </TabsList>

        {/* Connection Tab */}
        <TabsContent value="connection" className="mt-1 space-y-5">
          {/* Disconnected banner */}
          {isDisconnected && (
            <div className="flex items-center gap-3 rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4">
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
            <div className="flex items-center gap-3 rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-4">
              <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
              <div>
                <p className="text-sm font-medium">Setting up channel...</p>
                <p className="text-xs text-muted-foreground">This may take a few minutes.</p>
              </div>
            </div>
          )}

          {/* QR code display */}
          {isAwaitingScan && (
            <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-blue-500/30 bg-muted/30 p-5">
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
        <TabsContent value="ai-agent" className="mt-1 space-y-3">
          {/* AI Toggle */}
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3">
            <div className="flex justify-center pt-4.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-sm font-semibold">
                1
              </div>
            </div>
            <div className="rounded-lg border-2 p-4">
              <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">AI Agent</p>
                  <Badge
                    variant="outline"
                    className={settings.is_enabled ? modeConfig.badgeClass : 'border-muted-foreground/30 bg-muted text-muted-foreground'}
                  >
                    {settings.is_enabled ? modeConfig.label : 'Off'}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {settings.is_enabled
                    ? 'Start here, then choose the channel mode and the hours when AI should be active.'
                    : 'Turn on the AI agent to set its mode, active hours, and assigned agent.'}
                </p>
                {settings.is_enabled && !assignedAgent && (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    Warning: AI is on, but it will not respond until an agent is assigned.
                  </p>
                )}
              </div>
              <PlanGate>
                <Switch
                  checked={settings.is_enabled}
                  onCheckedChange={handleToggleAI}
                  disabled={toggling || loadingSettings}
                />
              </PlanGate>
            </div>
          </div>
          </div>

          {settings.is_enabled && (
            <div className="flex flex-col gap-3">
              {/* Response Mode */}
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3">
                <div className="flex justify-center pt-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-sm font-semibold">
                    2
                  </div>
                </div>
                <div className="rounded-lg border-2 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <ModeIcon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">AI Agent Mode</p>
                      <p className="text-xs text-muted-foreground">Control whether this channel’s AI is fully live or limited to selected test contacts.</p>
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
                    {([
                      { value: 'live', label: 'Live' },
                      { value: 'test', label: 'Test' },
                    ] as const).map((mode) => {
                      const active = settings.response_mode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          disabled={savingMode}
                          onClick={() => handleResponseModeChange(mode.value)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? mode.value === 'test'
                                ? 'bg-amber-100 text-amber-800 shadow-sm'
                                : 'bg-emerald-100 text-emerald-800 shadow-sm'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                          } ${savingMode ? 'opacity-60' : ''}`}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                  </div>
                  </div>

                  <div
                    className={`rounded-md px-3 py-2 ${
                      isTestMode
                        ? 'border border-amber-200 bg-amber-50/80'
                        : 'border border-emerald-200 bg-emerald-50/80'
                    }`}
                  >
                    <p
                      className={`text-xs font-medium ${
                        isTestMode ? 'text-amber-900' : 'text-emerald-900'
                      }`}
                    >
                      {isTestMode
                        ? 'In Test Mode, AI replies only to selected contacts.'
                        : 'In Live Mode, AI responds normally unless a contact is excluded.'}
                    </p>
                    <p
                      className={`mt-0.5 text-xs ${
                        isTestMode ? 'text-amber-800' : 'text-emerald-800'
                      }`}
                    >
                      {isTestMode
                        ? 'Any phone number not added below will never receive an AI response.'
                        : 'Any contact added below will never receive an AI response.'}
                    </p>
                  </div>

                  <div className="rounded-md border bg-background/70 p-3">
                    <button
                      type="button"
                      onClick={() => setModeListOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <p className="text-xs font-medium">
                          {isTestMode ? 'Allowed Contacts in Test Mode' : 'Exclude List'}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {isTestMode
                            ? `${settings.test_contact_ids.length} selected`
                            : `${settings.excluded_contact_ids.length} excluded`}
                        </p>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${modeListOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {modeListOpen && (
                      isTestMode ? (
                        <div className="mt-3 border-t pt-3">
                          <ChannelAgentContactList
                            description="Only these contacts will receive AI replies in test mode."
                            selectedIds={settings.test_contact_ids}
                            emptyLabel="No test contacts selected yet."
                            onChange={handleTestContactsChange}
                          />
                        </div>
                      ) : (
                        <div className="mt-3 border-t pt-3">
                          <ChannelAgentContactList
                            description="AI will stay silent for these contacts."
                            selectedIds={settings.excluded_contact_ids}
                            emptyLabel="No excluded contacts."
                            onChange={handleExcludedContactsChange}
                          />
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Schedule */}
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3">
                <div className="flex justify-center pt-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-sm font-semibold">
                    3
                  </div>
                </div>
                <div>
                  {loadingSettings ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    <ScheduleSection
                      scheduleMode={settings.schedule_mode}
                      scheduleConfigured={settings.schedule_configured}
                      aiSchedule={settings.ai_schedule}
                      companyTimezone={companyTimezone}
                      isExpanded={scheduleExpanded}
                      onToggle={() => setScheduleExpanded((prev) => !prev)}
                      onSave={handleSaveSchedule}
                    />
                  )}
                </div>
              </div>

              {/* Agent Assignment */}
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3">
                <div className="flex justify-center pt-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-sm font-semibold">
                    4
                  </div>
                </div>
                <div className={`rounded-lg border-2 p-4 ${assignedAgent ? 'border-emerald-200/80 bg-emerald-50/30' : 'border-amber-300 bg-amber-50/50'}`}>
                  {loadingAgents ? (
                    <Skeleton className="h-10 w-full" />
                  ) : agents.length === 0 ? (
                    <div className="flex items-center gap-3">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Assigned Agent</p>
                        <p className="text-xs text-muted-foreground">No agents created yet.</p>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/ai-agents">
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Create Agent
                        </Link>
                      </Button>
                    </div>
                  ) : assignedAgent ? (
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          Assigned Agent: {assignedAgent.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Handles AI replies on this channel.</p>
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
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Assigned Agent</p>
                        <p className="text-xs font-medium text-amber-900">No agent assigned</p>
                        <p className="mt-1 text-xs text-amber-800">AI is on, but it does not have an agent selected for this channel yet.</p>
                      </div>
                      <Select
                        value="__none__"
                        onValueChange={handleAgentChange}
                      >
                        <SelectTrigger size="sm" className="h-8 w-auto shrink-0 border-amber-300 bg-background">
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
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Auto-Reply section — shown when AI is OFF */}
          {!settings.is_enabled && (
            <div className="mt-3">
              {loadingSettings ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <AutoReplySection
                  autoReplyEnabled={settings.auto_reply_enabled}
                  autoReplyMessage={settings.auto_reply_message}
                  autoReplyMessages={settings.auto_reply_messages ?? []}
                  autoReplyTrigger={settings.auto_reply_trigger}
                  isExpanded={autoReplyExpanded}
                  onToggle={() => setAutoReplyExpanded((prev) => !prev)}
                  onSave={handleSaveAutoReply}
                />
              )}
            </div>
          )}
        </TabsContent>

        {/* Access Tab — only visible to channel owner */}
        {channel.is_owner && permissionSettings && (
          <TabsContent value="access" className="mt-1 space-y-5">
            <AccessManager
              mode="channel"
              variant="inline"
              channelMode={permissionSettings.mode}
              defaultLevel={permissionSettings.defaultLevel || undefined}
              onChannelModeChange={handleChannelModeChange}
              permissions={permissionSettings.permissions || []}
              teamMembers={teamMembers}
              ownerId={permissionSettings.owner.id}
              onGrant={grantAccess}
              onRevoke={revokeAccess}
              onLevelChange={grantAccess}
              canManage={channel.is_owner}
            />

            <ConflictResolutionModal
              open={conflictModalOpen}
              onOpenChange={setConflictModalOpen}
              conflicts={conflicts}
              onResolve={handleResolveConflicts}
            />
          </TabsContent>
        )}

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="mt-1 space-y-5">
          <ComplianceTab channelId={numericChannelId} companyId={''} />
        </TabsContent>

      </Tabs>
    </div>
  );
}
