import { Smartphone, Mail, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ChannelType = 'whatsapp' | 'email';

interface ChannelTypeConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

export const CHANNEL_TYPES: Record<ChannelType, ChannelTypeConfig> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: Smartphone,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  email: {
    label: 'Gmail',
    icon: Mail,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
};

export function getChannelConfig(type: string | null | undefined): ChannelTypeConfig {
  return CHANNEL_TYPES[type as ChannelType] || {
    label: 'Unknown',
    icon: MessageSquare,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
  };
}
