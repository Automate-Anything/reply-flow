import { Badge } from '../ui/Badge';

const eventVariants: Record<string, 'success' | 'info' | 'warning' | 'destructive' | 'default'> = {
  signup: 'success',
  renewal: 'info',
  upgrade: 'info',
  downgrade: 'warning',
  churn: 'destructive',
};

function EventTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={eventVariants[type] || 'default'}>
      {type}
    </Badge>
  );
}

export { EventTypeBadge };
