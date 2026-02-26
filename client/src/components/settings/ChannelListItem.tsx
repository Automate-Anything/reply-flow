import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2, QrCode, WifiOff } from 'lucide-react';
import type { ChannelInfo } from './channelHelpers';
import { formatChannelName, getStatusConfig } from './channelHelpers';

interface Props {
  channel: ChannelInfo;
  isActive: boolean;
  onClick: () => void;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-4.5 w-4.5 text-green-500" />;
    case 'pending':
      return <Loader2 className="h-4.5 w-4.5 text-amber-500 animate-spin" />;
    case 'awaiting_scan':
      return <QrCode className="h-4.5 w-4.5 text-blue-500" />;
    default:
      return <WifiOff className="h-4.5 w-4.5 text-muted-foreground" />;
  }
}

export default function ChannelListItem({ channel, isActive, onClick }: Props) {
  const statusConfig = getStatusConfig(channel.channel_status);
  const displayName = formatChannelName(channel);

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors',
        'hover:bg-accent',
        isActive && 'bg-accent'
      )}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', statusConfig.iconBg)}>
        {getStatusIcon(channel.channel_status)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', statusConfig.dotClass)} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {statusConfig.label}
        </p>
      </div>
    </button>
  );
}
