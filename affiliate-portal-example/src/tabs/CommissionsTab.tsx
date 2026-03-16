import { Receipt } from 'lucide-react';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { EventTypeBadge } from '../components/shared/EventTypeBadge';
import { formatCents, formatDate } from '../lib/utils';
import type { CommissionEvent } from '../hooks/usePortalData';

interface CommissionsTabProps {
  commissions: CommissionEvent[];
  dataLoading: boolean;
}

function CommissionsTab({ commissions, dataLoading }: CommissionsTabProps) {
  if (dataLoading && commissions.length === 0) {
    return (
      <div className="bg-[hsl(var(--card))] rounded-lg shadow p-4 space-y-3" role="tabpanel">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (commissions.length === 0) {
    return (
      <div role="tabpanel">
        <EmptyState
          icon={<Receipt className="h-12 w-12" />}
          title="No commission events yet"
          description="Commission events will appear here once your referrals generate revenue."
        />
      </div>
    );
  }

  return (
    <div role="tabpanel">
      <Table>
        <TableHeader>
          <TableHead className="text-left">Date</TableHead>
          <TableHead className="text-left">Event</TableHead>
          <TableHead className="text-left">Plan</TableHead>
          <TableHead className="text-right">Invoice</TableHead>
          <TableHead className="text-right">Commission</TableHead>
        </TableHeader>
        <TableBody>
          {commissions.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {formatDate(c.created_at)}
              </TableCell>
              <TableCell>
                <EventTypeBadge type={c.event_type} />
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {c.plan_name || '—'}
              </TableCell>
              <TableCell className="text-right text-[hsl(var(--muted-foreground))]">
                {formatCents(c.invoice_amount || 0)}
              </TableCell>
              <TableCell className="text-right font-medium text-[hsl(var(--foreground))]">
                {formatCents(c.commission_amount || 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export { CommissionsTab };
