import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import ChannelDetailView from '@/components/settings/ChannelDetailView';
import type { ChannelInfo } from '@/components/settings/channelHelpers';
import { formatChannelName, getStatusConfig } from '@/components/settings/channelHelpers';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, Loader2, QrCode, WifiOff,
} from 'lucide-react';

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

export default function SettingsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const handleChannelClick = (channel: ChannelInfo) => {
    setSelectedChannel(channel);
    setDialogOpen(true);
  };

  const handleChannelUpdate = () => {
    fetchChannels();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your WhatsApp channels and AI settings.
          </p>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : (
        <>
          {/* Channel list */}
          {channels.length > 0 && (
            <div className="space-y-3">
              {channels.map((ch) => {
                const statusConfig = getStatusConfig(ch.channel_status);
                const displayName = formatChannelName(ch);

                return (
                  <Card
                    key={ch.id}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => handleChannelClick(ch)}
                  >
                    <CardContent className="flex items-center gap-4 py-4 px-5">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${statusConfig.iconBg}`}>
                        {getStatusIcon(ch.channel_status)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{displayName}</p>
                          <Badge variant="outline" className={`shrink-0 text-xs ${statusConfig.badgeClass}`}>
                            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusConfig.dotClass}`} />
                            {statusConfig.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {ch.phone_number || ch.channel_name}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Add channel card — always shown */}
          <WhatsAppConnection onCreated={handleChannelCreated} />
        </>
      )}

      {/* Channel detail dialog */}
      {selectedChannel && (
        <ChannelDetailView
          channel={selectedChannel}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onUpdate={handleChannelUpdate}
        />
      )}
    </div>
  );
}
