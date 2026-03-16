import { Users } from 'lucide-react';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '../components/ui/Table';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/shared/StatusBadge';
import { formatCents, formatDate } from '../lib/utils';
import type { Referral } from '../hooks/usePortalData';

interface ReferralsTabProps {
  referrals: Referral[];
  dataLoading: boolean;
}

function ReferralsTab({ referrals, dataLoading }: ReferralsTabProps) {
  if (dataLoading && referrals.length === 0) {
    return (
      <div className="bg-[hsl(var(--card))] rounded-lg shadow p-4 space-y-3" role="tabpanel">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (referrals.length === 0) {
    return (
      <div role="tabpanel">
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No referrals yet"
          description="Share your affiliate link to start earning commissions."
        />
      </div>
    );
  }

  return (
    <div role="tabpanel">
      <Table>
        <TableHeader>
          <TableHead className="text-left">Company</TableHead>
          <TableHead className="text-left">Status</TableHead>
          <TableHead className="text-left">Plan</TableHead>
          <TableHead className="text-left">Billing</TableHead>
          <TableHead className="text-right">Commission</TableHead>
          <TableHead className="text-left">Signed Up</TableHead>
        </TableHeader>
        <TableBody>
          {referrals.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium text-[hsl(var(--foreground))]">
                {r.company_name}
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {r.plan_name || '—'}
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {r.billing_cycle || '—'}
              </TableCell>
              <TableCell className="text-right font-medium text-[hsl(var(--foreground))]">
                {formatCents(r.commission_earned || 0)}
              </TableCell>
              <TableCell className="text-[hsl(var(--muted-foreground))]">
                {formatDate(r.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export { ReferralsTab };
