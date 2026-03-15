// client/src/components/inbox/OverrideShieldIcon.tsx
import { Shield } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface OverrideShieldIconProps {
  escalationCount: number;
  restrictionCount: number;
  escalationNames: string[];
  restrictionNames: string[];
  onClick?: (e: React.MouseEvent) => void;
}

function formatNames(names: string[], max: number = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} other${names.length - max > 1 ? 's' : ''}`;
}

function buildTooltip(
  escalationNames: string[],
  restrictionNames: string[],
): string {
  const parts: string[] = [];
  if (escalationNames.length > 0) {
    parts.push(`${formatNames(escalationNames)} have elevated access`);
  }
  if (restrictionNames.length > 0) {
    parts.push(`${formatNames(restrictionNames)} restricted from this conversation`);
  }
  return parts.join('; ');
}

export default function OverrideShieldIcon({
  escalationCount,
  restrictionCount,
  escalationNames,
  restrictionNames,
  onClick,
}: OverrideShieldIconProps) {
  if (escalationCount === 0 && restrictionCount === 0) return null;

  const hasEscalation = escalationCount > 0;
  const hasRestriction = restrictionCount > 0;

  // Determine icon color and arrow indicator
  let colorClass = '';
  let arrow = '';

  if (hasEscalation && hasRestriction) {
    colorClass = 'text-blue-500'; // Mixed — use escalation color as primary
    arrow = '↑↓';
  } else if (hasEscalation) {
    colorClass = 'text-blue-500';
    arrow = '↑';
  } else {
    colorClass = 'text-red-500';
    arrow = '↓';
  }

  const tooltip = buildTooltip(escalationNames, restrictionNames);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={`flex items-center gap-0.5 ${colorClass} hover:opacity-80 transition-opacity`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold leading-none">{arrow}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[250px] text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
