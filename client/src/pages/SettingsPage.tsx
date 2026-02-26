import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import ChannelListItem from '@/components/settings/ChannelListItem';
import ChannelDetailView from '@/components/settings/ChannelDetailView';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import type { ChannelInfo } from '@/components/settings/channelHelpers';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus, Smartphone } from 'lucide-react';

export default function SettingsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [showAddFlow, setShowAddFlow] = useState(false);

  const fetchChannels = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/channels');
      setChannels(data.channels || []);
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Auto-select first channel if nothing selected and channels exist
  useEffect(() => {
    if (channels.length > 0 && selectedChannelId === null && !showAddFlow) {
      setSelectedChannelId(channels[0].id);
    }
    // If selected channel was deleted, clear selection
    if (selectedChannelId !== null && !channels.find((c) => c.id === selectedChannelId)) {
      setSelectedChannelId(channels.length > 0 ? channels[0].id : null);
    }
  }, [channels, selectedChannelId, showAddFlow]);

  const handleChannelCreated = () => {
    setShowAddFlow(false);
    fetchChannels().then(() => {
      // After refetch, the latest channel will be auto-selected via the effect
      // if selectedChannelId is null
    });
  };

  const handleAddChannel = () => {
    setShowAddFlow(true);
    setSelectedChannelId(null);
  };

  const handleSelectChannel = (id: number) => {
    setSelectedChannelId(id);
    setShowAddFlow(false);
  };

  const handleChannelUpdate = () => {
    fetchChannels();
  };

  const handleBack = () => {
    setSelectedChannelId(null);
    setShowAddFlow(false);
  };

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) || null;

  // --- Loading state ---
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  // --- No channels: show simple centered layout ---
  if (channels.length === 0 && !showAddFlow) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your connected accounts and AI preferences.
          </p>
        </div>
        <WhatsAppConnection onCreated={handleChannelCreated} />
        <AISettingsPanel />
      </div>
    );
  }

  // --- Channels exist (or adding): master-detail layout ---
  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
            <MessageSquare className="h-4.5 w-4.5 text-green-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Channels</h1>
            <p className="text-xs text-muted-foreground">
              {channels.length} channel{channels.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={handleAddChannel}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add Channel
        </Button>
      </div>

      {/* Master-detail body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — hidden on mobile when detail is showing */}
        <div
          className={`${
            selectedChannelId || showAddFlow ? 'hidden md:flex' : 'flex'
          } h-full w-full flex-col border-r md:w-[280px]`}
        >
          <div className="flex-1 overflow-y-auto p-1">
            {channels.map((ch) => (
              <ChannelListItem
                key={ch.id}
                channel={ch}
                isActive={ch.id === selectedChannelId && !showAddFlow}
                onClick={() => handleSelectChannel(ch.id)}
              />
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto">
          {showAddFlow ? (
            <div className="mx-auto max-w-lg p-6">
              <WhatsAppConnection onCreated={handleChannelCreated} />
            </div>
          ) : selectedChannel ? (
            <div>
              <ChannelDetailView
                channel={selectedChannel}
                onUpdate={handleChannelUpdate}
                onBack={handleBack}
              />
              <div className="border-t px-6 py-6">
                <AISettingsPanel />
              </div>
            </div>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex h-full">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Smartphone className="h-7 w-7 opacity-40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Select a channel</p>
                <p className="mt-0.5 text-xs">Choose from the list to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
