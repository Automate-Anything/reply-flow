import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
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
  affiliateId: string;
  onAssigned: () => void;
}

export function AssignScheduleDialog({ open, onOpenChange, affiliateId, onAssigned }: Props) {
  const [scheduleId, setScheduleId] = useState<string>('');
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setScheduleId('');
      setApplyToExisting(false);
      api.get<{ schedules: Schedule[] }>('/affiliate/admin/schedules')
        .then(({ data }) => setSchedules(data.schedules))
        .catch(() => toast.error('Failed to load schedules'));
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!scheduleId) {
      toast.error('Please select a schedule');
      return;
    }

    setSaving(true);
    try {
      await api.put(`/affiliate/admin/affiliates/${affiliateId}`, {
        commission_schedule_id: scheduleId,
        apply_to_existing_referrals: applyToExisting,
      });
      toast.success('Schedule assigned');
      onAssigned();
      onOpenChange(false);
    } catch {
      toast.error('Failed to assign schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Commission Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Schedule</Label>
            <Select value={scheduleId} onValueChange={setScheduleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent>
                {schedules.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="apply-existing" checked={applyToExisting} onCheckedChange={setApplyToExisting} />
            <Label htmlFor="apply-existing">Apply to existing referrals too?</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Assigning...' : 'Assign Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
