import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useWorkspaceAI } from '@/hooks/useWorkspaceAI';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft, Bot, Pencil, Trash2, Loader2, Smartphone,
  CheckCircle2, WifiOff, QrCode, Clock, Languages,
} from 'lucide-react';
import { toast } from 'sonner';
import AIProfileWizard from '@/components/settings/AIProfileWizard';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import ChannelDetailView from '@/components/settings/ChannelDetailView';
import BusinessHoursEditor, { getDefaultBusinessHours } from '@/components/settings/BusinessHoursEditor';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';
import type { ChannelInfo } from '@/components/settings/channelHelpers';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'he', label: 'Hebrew' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ru', label: 'Russian' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'tr', label: 'Turkish' },
];

interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
  default_language: string;
  business_hours: BusinessHours | null;
  created_at: string;
}

function getChannelStatusIcon(status: string) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'pending':
      return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />;
    case 'awaiting_scan':
      return <QrCode className="h-4 w-4 text-blue-500" />;
    default:
      return <WifiOff className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Channel detail dialog
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);

  // Schedule state
  const [language, setLanguage] = useState('en');
  const [businessHours, setBusinessHours] = useState<BusinessHours>(getDefaultBusinessHours());
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleInitialized, setScheduleInitialized] = useState(false);

  const {
    profile,
    loadingProfile,
    updateProfile,
  } = useWorkspaceAI(workspaceId);

  const fetchWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data } = await api.get(`/workspaces/${workspaceId}`);
      setWorkspace(data.workspace);
      setChannels(data.channels || []);
      setLanguage(data.workspace.default_language || 'en');
      setBusinessHours(data.workspace.business_hours || getDefaultBusinessHours());
      setScheduleInitialized(true);
    } catch {
      toast.error('Failed to load workspace');
      navigate('/settings?tab=workspaces');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, navigate]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const handleSaveEdit = async () => {
    if (!workspaceId || !editName.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/workspaces/${workspaceId}`, {
        name: editName.trim(),
        description: editDesc.trim() || null,
      });
      setWorkspace(data.workspace);
      setEditing(false);
      toast.success('Workspace updated');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!workspaceId) return;
    setDeleting(true);
    try {
      await api.delete(`/workspaces/${workspaceId}`);
      toast.success('Workspace deleted');
      navigate('/settings?tab=workspaces');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete workspace';
      toast.error(msg);
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

  const scheduleChanged = scheduleInitialized && workspace && (
    language !== (workspace.default_language || 'en') ||
    JSON.stringify(businessHours) !== JSON.stringify(workspace.business_hours || getDefaultBusinessHours())
  );

  const handleSaveSchedule = async () => {
    if (!workspaceId) return;
    setSavingSchedule(true);
    try {
      const { data } = await api.put(`/workspaces/${workspaceId}`, {
        default_language: language,
        business_hours: businessHours,
      });
      setWorkspace(data.workspace);
      toast.success('Schedule settings updated');
    } catch {
      toast.error('Failed to update schedule settings');
    } finally {
      setSavingSchedule(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!workspace) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings?tab=workspaces')} className="mt-0.5">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-3">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Workspace name"
                className="text-lg font-semibold"
              />
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} disabled={!editName.trim() || saving}>
                  {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setEditName(workspace.name);
                    setEditDesc(workspace.description || '');
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
              {workspace.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{workspace.description}</p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete workspace?</span>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* AI Toggle */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Bot className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">AI Agent</p>
            <p className="text-xs text-muted-foreground">
              {profile.is_enabled ? 'AI is responding on all enabled channels' : 'AI is disabled for this workspace'}
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
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="channels">
        <TabsList className="w-full">
          <TabsTrigger value="channels" className="flex-1">
            Channels ({channels.length})
          </TabsTrigger>
          <TabsTrigger value="ai-profile" className="flex-1">
            AI Profile
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1">
            Schedule
          </TabsTrigger>
        </TabsList>

        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Channels in this workspace use its AI profile. Click a channel to configure it.
          </p>

          {channels.length > 0 && (
            <div className="space-y-2">
              {channels.map((ch) => (
                <Card
                  key={ch.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => setSelectedChannel(ch)}
                >
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getChannelStatusIcon(ch.channel_status)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {ch.phone_number || ch.channel_name}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{ch.channel_status}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {channels.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <Smartphone className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No channels yet</p>
                <p className="text-xs text-muted-foreground">Create a new WhatsApp channel below.</p>
              </CardContent>
            </Card>
          )}

          {/* Inline channel creation */}
          {workspaceId && (
            <WhatsAppConnection workspaceId={workspaceId} onCreated={fetchWorkspace} />
          )}
        </TabsContent>

        {/* AI Profile Tab */}
        <TabsContent value="ai-profile">
          {loadingProfile ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <AIProfileWizard profile={profile} onSave={updateProfile} />
          )}
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="space-y-6">
          {/* Default Language */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Default Language</p>
              </div>
              <p className="text-xs text-muted-foreground">
                The primary language the AI agent will use when responding to customers.
              </p>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Business Hours */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Business Hours</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Set when your team is available. The AI can adjust its responses outside business hours.
              </p>
              <BusinessHoursEditor value={businessHours} onChange={setBusinessHours} />
            </CardContent>
          </Card>

          {/* Save button */}
          {scheduleChanged && (
            <div className="flex justify-end">
              <Button onClick={handleSaveSchedule} disabled={savingSchedule}>
                {savingSchedule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Schedule
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Channel Detail Dialog */}
      {selectedChannel && (
        <ChannelDetailView
          channel={selectedChannel}
          open={!!selectedChannel}
          onOpenChange={(open) => { if (!open) setSelectedChannel(null); }}
          onUpdate={fetchWorkspace}
        />
      )}
    </div>
  );
}
