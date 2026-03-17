import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft } from 'lucide-react';
import { AssignScheduleDialog } from './AssignScheduleDialog';

interface AffiliateDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  approval_status: string;
  affiliate_code: string;
  stripe_connect_account_id: string | null;
  bank_account_added: boolean;
  commission_schedule_id: string | null;
  commission_type: string | null;
  commission_rate: number | null;
  created_at: string;
  updated_at: string;
}

interface Referral {
  id: string;
  company_id: string;
  status: string;
  payment_count: number;
  last_plan_name: string | null;
  commission_schedule_id: string | null;
  schedule_override_applied: boolean;
  created_at: string;
}

interface CommissionEvent {
  id: string;
  referral_id: string;
  event_type: string;
  payment_number: number;
  plan_name: string | null;
  invoice_amount_cents: number;
  commission_amount_cents: number;
  stripe_invoice_id: string | null;
  payout_id: string | null;
  created_at: string;
}

interface Payout {
  id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: string;
  stripe_transfer_id: string | null;
  paid_at: string | null;
  created_at: string;
}

interface Props {
  affiliateId: string;
  onBack: () => void;
}

export function AffiliateDetailView({ affiliateId, onBack }: Props) {
  const [affiliate, setAffiliate] = useState<AffiliateDetail | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissionEvents, setCommissionEvents] = useState<CommissionEvent[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/affiliate/admin/affiliates/${affiliateId}`);
      setAffiliate(data.affiliate);
      setReferrals(data.referrals || []);
      setCommissionEvents(data.recent_commission_events || []);
      setPayouts(data.payouts || []);
    } catch {
      toast.error('Failed to load affiliate details');
    } finally {
      setLoading(false);
    }
  }, [affiliateId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) return <Skeleton className="h-96" />;
  if (!affiliate) return <p className="text-sm text-muted-foreground">Affiliate not found.</p>;

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved': case 'active': case 'paid': return 'default';
      case 'pending': case 'trialing': return 'secondary';
      case 'rejected': case 'failed': case 'churned': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <h2 className="text-lg font-semibold">{affiliate.name}</h2>
        <Badge variant={statusBadgeVariant(affiliate.approval_status)}>
          {affiliate.approval_status}
        </Badge>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Affiliate Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Email</span>
              <p className="font-medium">{affiliate.email}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Phone</span>
              <p className="font-medium">{affiliate.phone || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Code</span>
              <p className="font-medium font-mono">{affiliate.affiliate_code}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Stripe Connected</span>
              <p className="font-medium">{affiliate.stripe_connect_account_id ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Bank Account</span>
              <p className="font-medium">{affiliate.bank_account_added ? 'Added' : 'Not added'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Joined</span>
              <p className="font-medium">{new Date(affiliate.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
              Assign Schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Referrals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Referrals ({referrals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Referred</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referrals.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.payment_count}</TableCell>
                      <TableCell>{r.last_plan_name || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commission Events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Commission Events ({commissionEvents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {commissionEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commission events yet.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Payment #</TableHead>
                    <TableHead className="text-right">Invoice</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Paid Out</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionEvents.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge variant="outline">{e.event_type}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{e.payment_number}</TableCell>
                      <TableCell className="text-right">${(e.invoice_amount_cents / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${(e.commission_amount_cents / 100).toFixed(2)}</TableCell>
                      <TableCell>{e.payout_id ? 'Yes' : 'No'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(e.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payouts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payouts ({payouts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payouts yet.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transfer ID</TableHead>
                    <TableHead>Paid At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(p.period_start).toLocaleDateString()} - {new Date(p.period_end).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right font-medium">${(p.amount_cents / 100).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(p.status)}>{p.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.stripe_transfer_id || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AssignScheduleDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        affiliateId={affiliateId}
        onAssigned={fetchDetail}
      />
    </div>
  );
}
