import { Badge } from '../ui/Badge';

const statusVariants: Record<string, 'success' | 'info' | 'destructive' | 'warning' | 'default'> = {
  active: 'success',
  trialing: 'info',
  churned: 'destructive',
  pending: 'warning',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariants[status] || 'default'}>
      {status}
    </Badge>
  );
}

export { StatusBadge };
