// client/src/components/access/PermissionLevelSelect.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, MessageSquare, Settings, Ban } from 'lucide-react';
import type { AccessLevel } from '@/hooks/usePermissions';

interface PermissionLevelSelectProps {
  value: AccessLevel;
  onChange: (level: AccessLevel) => void;
  disabled?: boolean;
  showNoAccess?: boolean;
  size?: 'sm' | 'default';
}

const LEVEL_CONFIG: Record<AccessLevel, { label: string; icon: typeof Eye; color: string }> = {
  no_access: { label: 'No Access', icon: Ban, color: 'text-red-500' },
  view: { label: 'View', icon: Eye, color: 'text-muted-foreground' },
  reply: { label: 'Reply', icon: MessageSquare, color: 'text-blue-500' },
  manage: { label: 'Manage', icon: Settings, color: 'text-amber-500' },
};

export default function PermissionLevelSelect({
  value,
  onChange,
  disabled = false,
  showNoAccess = true,
  size = 'default',
}: PermissionLevelSelectProps) {
  const levels: AccessLevel[] = showNoAccess
    ? ['no_access', 'view', 'reply', 'manage']
    : ['view', 'reply', 'manage'];

  return (
    <Select value={value} onValueChange={(v) => onChange(v as AccessLevel)} disabled={disabled}>
      <SelectTrigger className={size === 'sm' ? 'h-7 text-xs w-[100px]' : 'w-[130px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => {
          const config = LEVEL_CONFIG[level];
          const Icon = config.icon;
          return (
            <SelectItem key={level} value={level}>
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                <span>{config.label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
