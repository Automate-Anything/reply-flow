import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Plus, Eye, Check, X, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InviteAffiliateDialog } from './InviteAffiliateDialog';
import { AssignScheduleDialog } from './AssignScheduleDialog';
import { AffiliateDetailView } from './AffiliateDetailView';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  approval_status: string;
  affiliate_code: string;
  commission_schedule_id: string | null;
  bank_account_added: boolean;
  created_at: string;
  referral_count: number;
  total_earned_cents: number;
  pending_payout_cents: number;
}

interface ScheduleMap {
  [id: string]: string;
}

export function AffiliateListTab() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [assignScheduleAffId, setAssignScheduleAffId] = useState<string | null>(null);
  const [detailAffId, setDetailAffId] = useState<string | null>(null);
  const [scheduleNames, setScheduleNames] = useState<ScheduleMap>({});
  const [editAff, setEditAff] = useState<Affiliate | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '' });
  const [editSaving, setEditSaving] = useState(false);

  // Fetch schedule names for display
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ schedules: { id: string; name: string }[] }>('/affiliate/admin/schedules');
        const map: ScheduleMap = {};
        for (const s of data.schedules) map[s.id] = s.name;
        setScheduleNames(map);
      } catch { /* non-critical */ }
    })();
  }, []);

  const handleEdit = (aff: Affiliate) => {
    setEditAff(aff);
    setEditForm({ name: aff.name, email: aff.email, phone: aff.phone || '' });
  };

  const handleEditSave = async () => {
    if (!editAff) return;
    setEditSaving(true);
    try {
      await api.put(`/affiliate/admin/affiliates/${editAff.id}`, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone || null,
      });
      toast.success('Affiliate updated');
      setEditAff(null);
      fetchAffiliates();
    } catch {
      toast.error('Failed to update affiliate');
    } finally {
      setEditSaving(false);
    }
  };

  const fetchAffiliates = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? { status: statusFilter } : {};
      const { data } = await api.get<{ affiliates: Affiliate[] }>('/affiliate/admin/affiliates', { params });
      setAffiliates(data.affiliates);
    } catch {
      toast.error('Failed to load affiliates');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAffiliates();
  }, [fetchAffiliates]);

  const handleApprove = async (id: string) => {
    try {
      await api.put(`/affiliate/admin/affiliates/${id}`, { approval_status: 'approved' });
      toast.success('Affiliate approved');
      fetchAffiliates();
    } catch {
      toast.error('Failed to approve affiliate');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await api.put(`/affiliate/admin/affiliates/${id}`, { approval_status: 'rejected' });
      toast.success('Affiliate rejected');
      fetchAffiliates();
    } catch {
      toast.error('Failed to reject affiliate');
    }
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved': return 'default';
      case 'pending': return 'secondary';
      case 'rejected': return 'destructive';
      default: return 'outline';
    }
  };

  if (detailAffId) {
    return (
      <AffiliateDetailView
        affiliateId={detailAffId}
        onBack={() => { setDetailAffId(null); fetchAffiliates(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Affiliates</h2>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Invite Affiliate
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : affiliates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No affiliates found.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Referrals</TableHead>
                <TableHead className="text-right">Total Earned</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affiliates.map((aff) => (
                <TableRow key={aff.id}>
                  <TableCell className="font-medium">{aff.name}</TableCell>
                  <TableCell className="text-muted-foreground">{aff.email}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(aff.approval_status)}>
                      {aff.approval_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{aff.referral_count}</TableCell>
                  <TableCell className="text-right">${(aff.total_earned_cents / 100).toFixed(2)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {aff.commission_schedule_id ? (scheduleNames[aff.commission_schedule_id] || '—') : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(aff.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {aff.approval_status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => handleApprove(aff.id)} title="Approve">
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleReject(aff.id)} title="Reject">
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(aff)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAssignScheduleAffId(aff.id)} title="Assign Schedule">
                        Sched
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDetailAffId(aff.id)} title="View Details">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InviteAffiliateDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={fetchAffiliates}
      />

      {assignScheduleAffId && (
        <AssignScheduleDialog
          open={!!assignScheduleAffId}
          onOpenChange={(open) => { if (!open) setAssignScheduleAffId(null); }}
          affiliateId={assignScheduleAffId}
          onAssigned={fetchAffiliates}
        />
      )}

      <Dialog open={!!editAff} onOpenChange={(open) => { if (!open) setEditAff(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Affiliate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAff(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving || !editForm.name || !editForm.email}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
