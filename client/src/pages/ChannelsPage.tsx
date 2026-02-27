import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2, Smartphone,
  CheckCircle2, WifiOff, QrCode,
} from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
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
  const navigate = useNavigate();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/whatsapp/channels');
      setChannels(data.channels || []);
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground">
          Manage your WhatsApp channels and AI profiles.
        </p>
      </div>

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
                  onClick={() => navigate(`/channels/${ch.id}`)}
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

          <WhatsAppConnection onCreated={fetchChannels} />
        </div>
      )}
    </div>
  );
}
