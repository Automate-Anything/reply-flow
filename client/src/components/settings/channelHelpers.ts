export interface ChannelInfo {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_status: string;
  phone_number: string | null;
  profile_picture_url: string | null;
  profile_name: string | null;
  webhook_registered: boolean;
  created_at: string;
  user_id?: string;
  sharing_mode?: 'private' | 'specific_users' | 'all_members';
  default_conversation_visibility?: 'all' | 'owner_only';
  is_owner?: boolean;
}

export type StatusConfig = {
  label: string;
  badgeClass: string;
  dotClass: string;
  iconBg: string;
};

export function formatChannelName(channel: ChannelInfo): string {
  if (channel.phone_number) return channel.phone_number;
  const name = channel.channel_name;
  // Auto-generated names follow the pattern reply-flow-<userId>-<timestamp>
  if (name.startsWith('reply-flow-')) {
    const rest = name.slice('reply-flow-'.length);
    const dashIdx = rest.indexOf('-');
    if (dashIdx > 0) return `Channel ${rest.slice(0, dashIdx).slice(0, 8)}`;
  }
  // User-chosen names pass through as-is
  return name;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        badgeClass: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
        dotClass: 'bg-green-500',
        iconBg: 'bg-green-500/10',
      };
    case 'pending':
      return {
        label: 'Setting up...',
        badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
        dotClass: 'bg-amber-500 animate-pulse',
        iconBg: 'bg-amber-500/10',
      };
    case 'awaiting_scan':
      return {
        label: 'Scan QR code',
        badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
        dotClass: 'bg-blue-500 animate-pulse',
        iconBg: 'bg-blue-500/10',
      };
    default:
      return {
        label: 'Disconnected',
        badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
        dotClass: 'bg-destructive',
        iconBg: 'bg-destructive/10',
      };
  }
}

export function getSubtitle(status: string, createdAt: string): string {
  switch (status) {
    case 'pending':
      return 'Setting up... This may take a few minutes.';
    case 'awaiting_scan':
      return 'Scan the QR code to connect.';
    default:
      return `Created ${timeAgo(createdAt)}`;
  }
}

/** Format E.164 phone like +1 (973) 475-5144 */
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // US/CA numbers: 1 + 10 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7);
    return `+1 (${area}) ${prefix}-${line}`;
  }
  // Other international: just add spaces after country code
  return phone.startsWith('+') ? phone : `+${phone}`;
}

export function getCardBorder(status: string): string | undefined {
  switch (status) {
    case 'pending': return 'border-amber-500/30';
    case 'awaiting_scan': return 'border-blue-500/30';
    case 'connected': return 'border-green-500/20';
    default: return 'border-destructive/20';
  }
}
