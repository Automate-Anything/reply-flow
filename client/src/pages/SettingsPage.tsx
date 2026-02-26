import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import WhatsAppChannelCard from '@/components/settings/WhatsAppChannelCard';
import type { ChannelInfo } from '@/components/settings/WhatsAppChannelCard';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare } from 'lucide-react';

export default function SettingsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleChannelCreated = () => {
    fetchChannels();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your connected accounts and AI preferences.
        </p>
      </div>

      {/* WhatsApp Channels Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
            <MessageSquare className="h-4.5 w-4.5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">WhatsApp Channels</h2>
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp accounts to send and receive messages.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch) => (
              <WhatsAppChannelCard key={ch.id} channel={ch} onUpdate={fetchChannels} />
            ))}
            <WhatsAppConnection onCreated={handleChannelCreated} />
          </div>
        )}
      </div>

      <AISettingsPanel />
    </div>
  );
}
