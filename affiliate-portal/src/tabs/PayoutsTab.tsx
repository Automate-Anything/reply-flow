import { useState, useEffect } from 'react';
import { Wallet } from 'lucide-react';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { getPayoutHistory } from '../api';
import { formatCents, formatDate } from '../lib/utils';

interface Payout {
  id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: string;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
}

const statusVariant: Record<string, 'warning' | 'info' | 'success' | 'destructive'> = {
  pending: 'warning',
  approved: 'info',
  paid: 'success',
  rejected: 'destructive',
};

function PayoutsTab() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPayoutHistory();
        if (!cancelled) {
          setPayouts(res.payouts);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load payouts');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="bg-[hsl(var(--card))] rounded-lg shadow p-4 space-y-3" role="tabpanel">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="tabpanel">
        <EmptyState
          icon={<Wallet className="h-12 w-12" />}
          title="Failed to load payouts"
          description={error}
        />
      </div>
    );
  }

  if (payouts.length === 0) {
    return (
      <div role="tabpanel">
        <EmptyState
          icon={<Wallet className="h-12 w-12" />}
          title="No payouts yet"
          description="Payouts will appear here once commissions are processed."
        />
      </div>
    );
  }

  return (
    <div role="tabpanel">
      <Table>
        <TableHeader>
          <TableHead className="text-left">Period</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-left">Status</TableHead>
          <TableHead className="text-left">Payment Method</TableHead>
          <TableHead className="text-left">Paid On</TableHead>
        </TableHeader>
        <TableBody>
          {payouts.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="text-[hsl(var(--foreground))]">
                {formatDate(p.period_start)} - {formatDate(p.period_end)}
              </TableCell>
              <TableCell className="text-right font-medium text-[hsl(var(--foreground))]">
                {formatCents(p.amount_cents)}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[p.status] || 'default'}>
                  {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                </Badge>
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {p.payment_method || '\u2014'}
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {p.paid_at ? formatDate(p.paid_at) : '\u2014'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export { PayoutsTab };
