import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, Play, RotateCcw, Settings2 } from 'lucide-react';
import { PayoutSettingsDialog } from './PayoutSettingsDialog';

interface Payout {
  id: string;
  affiliate_id: string;
  affiliate_name: string;
  affiliate_email: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: string;
  stripe_transfer_id: string | null;
  paid_at: string | null;
  created_at: string;
}

export function PayoutListTab() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? { status: statusFilter } : {};
      const { data } = await api.get<{ payouts: Payout[] }>('/affiliate/admin/payouts', { params });
      setPayouts(data.payouts);
    } catch {
      toast.error('Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const handleRunPayouts = async () => {
    if (!confirm('Are you sure you want to run payouts now? This will trigger real Stripe transfers to affiliate bank accounts.')) {
      return;
    }
    setRunning(true);
    try {
      const { data } = await api.post('/affiliate/admin/payouts/run');
      toast.success(`Payout run complete. ${data.processed || 0} processed, ${data.failed || 0} failed.`);
      fetchPayouts();
    } catch {
      toast.error('Failed to run payouts');
    } finally {
      setRunning(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await api.post(`/affiliate/admin/payouts/${id}/retry`);
      toast.success('Payout queued for retry');
      fetchPayouts();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to retry payout');
    } finally {
      setRetrying(null);
    }
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'paid': return 'default';
      case 'pending': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Affiliate Payouts</h2>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" /> Settings
          </Button>
          <Button size="sm" onClick={handleRunPayouts} disabled={running}>
            <Play className="mr-1 h-4 w-4" /> {running ? 'Running...' : 'Run Payouts Now'}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : payouts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No payouts found.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Affiliate</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transfer ID</TableHead>
                <TableHead>Paid At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{payout.affiliate_name}</p>
                      <p className="text-xs text-muted-foreground">{payout.affiliate_email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(payout.period_start).toLocaleDateString()} -{' '}
                    {new Date(payout.period_end).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ${(payout.amount_cents / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(payout.status)}>{payout.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {payout.stripe_transfer_id || '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {payout.paid_at ? new Date(payout.paid_at).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {payout.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRetry(payout.id)}
                        disabled={retrying === payout.id}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        {retrying === payout.id ? 'Retrying...' : 'Retry'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PayoutSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
