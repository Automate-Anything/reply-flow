import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Loader2, Smartphone, CheckCircle2, CircleX, QrCode, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import WhatsAppConnection from '@/components/settings/WhatsAppConnection';
import { formatChannelName, getStatusConfig, getCardBorder, type ChannelInfo } from '@/components/settings/channelHelpers';

function getStatusIcon(status: string) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case 'pending':
      return <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />;
    case 'awaiting_scan':
      return <QrCode className="h-3 w-3 text-blue-500" />;
    default:
      return <CircleX className="h-3 w-3 text-destructive" />;
  }
}

function formatPhone(phone: string): string {
  // Format phone like +1 (234) 567-8901 if it's a US-style number, otherwise just prefix with +
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length >= 10) {
    return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
  }
  return `+${digits}`;
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
          Connect and manage your WhatsApp lines.
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
          {channels.length > 0 && (
            <div className="space-y-2">
              {channels.map((ch) => {
                const status = getStatusConfig(ch.channel_status);
                const borderClass = getCardBorder(ch.channel_status);
                return (
                  <Card
                    key={ch.id}
                    className={`cursor-pointer transition-all hover:bg-accent/50 hover:border-primary/30 group py-0 gap-0 ${borderClass || ''}`}
                    onClick={() => navigate(`/channels/${ch.id}`)}
                  >
                    <CardContent className="flex items-center gap-3 py-4 px-4">
                      <div className="relative">
                        <Avatar>
                          {ch.profile_picture_url ? (
                            <AvatarImage src={ch.profile_picture_url} alt={formatChannelName(ch)} />
                          ) : null}
                          <AvatarFallback>
                            <Smartphone className="h-4 w-4 text-muted-foreground" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background">
                          {getStatusIcon(ch.channel_status)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {ch.phone_number ? formatPhone(ch.phone_number) : formatChannelName(ch)}
                        </p>
                        <p className={`text-xs ${ch.channel_status === 'disconnected' ? 'text-destructive' : 'text-muted-foreground'}`}>{status.label}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </CardContent>
                  </Card>
                );
              })}
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
