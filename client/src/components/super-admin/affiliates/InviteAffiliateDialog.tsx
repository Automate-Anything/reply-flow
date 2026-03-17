import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Schedule {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function InviteAffiliateDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [scheduleId, setScheduleId] = useState<string>('none');
  const [autoApprove, setAutoApprove] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [saving, setSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      api.get<{ schedules: Schedule[] }>('/affiliate/admin/schedules')
        .then(({ data }) => setSchedules(data.schedules))
        .catch(() => {});
    }
  }, [open]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setScheduleId('none');
    setAutoApprove(true);
    setTempPassword(null);
  };

  const handleClose = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error('Name and email are required');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post('/affiliate/admin/affiliates', {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        commission_schedule_id: scheduleId !== 'none' ? scheduleId : null,
        approval_status: autoApprove ? 'approved' : 'pending',
      });
      toast.success('Affiliate created');
      setTempPassword(data.tempPassword || null);
      onCreated();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create affiliate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Affiliate</DialogTitle>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-4 py-4">
            <p className="text-sm">Affiliate created successfully. Share these credentials:</p>
            <div className="rounded-md bg-muted p-3 font-mono text-sm">
              <p>Email: {email}</p>
              <p>Temp Password: {tempPassword}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              This password will not be shown again.
            </p>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-phone">Phone (optional)</Label>
              <Input id="invite-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 ..." />
            </div>
            <div className="space-y-2">
              <Label>Commission Schedule</Label>
              <Select value={scheduleId} onValueChange={setScheduleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select schedule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No schedule</SelectItem>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="auto-approve" checked={autoApprove} onCheckedChange={setAutoApprove} />
              <Label htmlFor="auto-approve">Auto-approve (skip pending status)</Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Creating...' : 'Create Affiliate'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
