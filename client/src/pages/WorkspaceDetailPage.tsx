import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useWorkspaceAI } from '@/hooks/useWorkspaceAI';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Bot, Pencil, Trash2, Loader2, Plus, Smartphone, X,
  CheckCircle2, WifiOff, QrCode,
} from 'lucide-react';
import { toast } from 'sonner';
import AIProfileWizard from '@/components/settings/AIProfileWizard';
import KnowledgeBase from '@/components/settings/KnowledgeBase';
import type { ChannelInfo } from '@/components/settings/channelHelpers';

interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
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

  // For adding channels
  const [unassignedChannels, setUnassignedChannels] = useState<ChannelInfo[]>([]);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [selectedChannelToAdd, setSelectedChannelToAdd] = useState<string>('');
  const [addingChannel, setAddingChannel] = useState(false);

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
  } = useWorkspaceAI(workspaceId);

  const fetchWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data } = await api.get(`/workspaces/${workspaceId}`);
      setWorkspace(data.workspace);
      setChannels(data.channels || []);
    } catch {
      toast.error('Failed to load workspace');
      navigate('/workspaces');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, navigate]);

  const fetchUnassigned = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/channels');
      const all: ChannelInfo[] = data.channels || [];
      const assigned = new Set(channels.map((c) => c.id));
      setUnassignedChannels(all.filter((c) => !assigned.has(c.id) && !c.workspace_id));
    } catch {
      // ignore
    }
  }, [channels]);

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
      navigate('/workspaces');
    } catch {
      toast.error('Failed to delete workspace');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddChannel = async () => {
    if (!workspaceId || !selectedChannelToAdd) return;
    setAddingChannel(true);
    try {
      await api.post(`/workspaces/${workspaceId}/channels`, { channelId: Number(selectedChannelToAdd) });
      toast.success('Channel added to workspace');
      setShowAddChannel(false);
      setSelectedChannelToAdd('');
      fetchWorkspace();
    } catch {
      toast.error('Failed to add channel');
    } finally {
      setAddingChannel(false);
    }
  };

  const handleRemoveChannel = async (channelId: number) => {
    if (!workspaceId) return;
    try {
      await api.delete(`/workspaces/${workspaceId}/channels/${channelId}`);
      toast.success('Channel removed from workspace');
      fetchWorkspace();
    } catch {
      toast.error('Failed to remove channel');
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
        <Button variant="ghost" size="icon" onClick={() => navigate('/workspaces')} className="mt-0.5">
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
          <TabsTrigger value="knowledge-base" className="flex-1">
            Knowledge Base ({kbEntries.length})
          </TabsTrigger>
        </TabsList>

        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Channels assigned to this workspace will use its AI profile and knowledge base.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                fetchUnassigned();
                setShowAddChannel(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add Channel
            </Button>
          </div>

          {channels.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <Smartphone className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No channels assigned yet</p>
                <p className="text-xs text-muted-foreground">Add a channel to start using AI on it.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {channels.map((ch) => (
                <Card key={ch.id}>
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getChannelStatusIcon(ch.channel_status)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {ch.phone_number || ch.channel_name}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{ch.channel_status}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveChannel(ch.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
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

        {/* Knowledge Base Tab */}
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

      {/* Add channel dialog */}
      <Dialog open={showAddChannel} onOpenChange={setShowAddChannel}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Channel</DialogTitle>
            <DialogDescription>
              Select a channel to assign to this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {unassignedChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No unassigned channels available. Create a new channel first or remove one from another workspace.
              </p>
            ) : (
              <Select value={selectedChannelToAdd} onValueChange={setSelectedChannelToAdd}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a channel" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedChannels.map((ch) => (
                    <SelectItem key={ch.id} value={String(ch.id)}>
                      {ch.phone_number || ch.channel_name} ({ch.channel_status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddChannel(false)}>Cancel</Button>
              <Button
                onClick={handleAddChannel}
                disabled={!selectedChannelToAdd || addingChannel}
              >
                {addingChannel && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
