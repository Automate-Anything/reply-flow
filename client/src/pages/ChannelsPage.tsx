import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceAI } from '@/hooks/useWorkspaceAI';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bot, Loader2, Smartphone,
  CheckCircle2, WifiOff, QrCode,
} from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import ChannelDetailView from '@/components/settings/ChannelDetailView';
import type { ChannelInfo } from '@/components/settings/channelHelpers';

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

export default function ChannelsPage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [toggling, setToggling] = useState(false);

  const {
    profile,
    loadingProfile,
    updateProfile,
  } = useWorkspaceAI(activeWorkspaceId);

  const fetchChannels = useCallback(async () => {
    if (!activeWorkspaceId) {
      setChannels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/workspaces/${activeWorkspaceId}`);
      setChannels(data.channels || []);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

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

  if (!activeWorkspaceId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Smartphone className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Select a workspace from the sidebar to manage channels.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">{activeWorkspace?.name}</h2>
        <p className="text-sm text-muted-foreground">
          Manage WhatsApp channels for this workspace.
        </p>
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

      {/* Channel List */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click a channel to configure it.
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

          <WhatsAppConnection workspaceId={activeWorkspaceId} onCreated={fetchChannels} />
        </div>
      )}

      {/* Channel Detail Dialog */}
      {selectedChannel && (
        <ChannelDetailView
          channel={selectedChannel}
          open={!!selectedChannel}
          onOpenChange={(open) => { if (!open) setSelectedChannel(null); }}
          onUpdate={fetchChannels}
        />
      )}
    </div>
  );
}
