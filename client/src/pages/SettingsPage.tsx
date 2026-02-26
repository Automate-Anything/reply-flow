import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import WhatsAppChannelCard from '@/components/settings/WhatsAppChannelCard';
import type { ChannelInfo } from '@/components/settings/WhatsAppChannelCard';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import { Skeleton } from '@/components/ui/skeleton';

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
        <h2 className="text-lg font-semibold">WhatsApp Channels</h2>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : (
          <>
            {channels.map((ch) => (
              <WhatsAppChannelCard key={ch.id} channel={ch} onUpdate={fetchChannels} />
            ))}
            <WhatsAppConnection onCreated={handleChannelCreated} />
          </>
        )}
      </div>

      <AISettingsPanel />
    </div>
  );
}
