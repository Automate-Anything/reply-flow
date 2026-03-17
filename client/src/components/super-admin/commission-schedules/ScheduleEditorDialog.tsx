import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import type { Schedule } from './ScheduleListTab';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: Schedule | null; // null = create mode
  onSaved: () => void;
}

interface PeriodRow {
  from_payment: number;
  to_payment: number;
  rate: number;
}

export function ScheduleEditorDialog({ open, onOpenChange, schedule, onSaved }: Props) {
  const [name, setName] = useState('');
  const [commissionType, setCommissionType] = useState<string>('percentage');
  const [endBehavior, setEndBehavior] = useState<string>('stop');
  const [endRate, setEndRate] = useState<string>('');
  const [periods, setPeriods] = useState<PeriodRow[]>([{ from_payment: 1, to_payment: 12, rate: 20 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && schedule) {
      setName(schedule.name);
      setCommissionType(schedule.commission_type);
      setEndBehavior(schedule.end_behavior);
      setEndRate(schedule.end_rate?.toString() || '');
      setPeriods(
        schedule.periods.map((p) => ({
          from_payment: p.from_payment,
          to_payment: p.to_payment,
          rate: p.rate,
        }))
      );
    } else if (open && !schedule) {
      setName('');
      setCommissionType('percentage');
      setEndBehavior('stop');
      setEndRate('');
      setPeriods([{ from_payment: 1, to_payment: 12, rate: 20 }]);
    }
  }, [open, schedule]);

  const addPeriod = () => {
    const lastPeriod = periods[periods.length - 1];
    setPeriods([
      ...periods,
      {
        from_payment: lastPeriod ? lastPeriod.to_payment + 1 : 1,
        to_payment: lastPeriod ? lastPeriod.to_payment + 12 : 12,
        rate: lastPeriod?.rate || 10,
      },
    ]);
  };

  const removePeriod = (index: number) => {
    if (periods.length <= 1) return;
    setPeriods(periods.filter((_, i) => i !== index));
  };

  const updatePeriod = (index: number, field: keyof PeriodRow, value: number) => {
    setPeriods(periods.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    const payload = {
      name: name.trim(),
      commission_type: commissionType,
      end_behavior: endBehavior,
      end_rate: endBehavior === 'custom_rate' ? parseFloat(endRate) || null : null,
      periods,
    };

    setSaving(true);
    try {
      if (schedule) {
        await api.put(`/affiliate/admin/schedules/${schedule.id}`, payload);
        toast.success('Schedule updated');
      } else {
        await api.post('/affiliate/admin/schedules', payload);
        toast.success('Schedule created');
      }
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="sched-name">Name</Label>
            <Input id="sched-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard 20%" />
          </div>

          <div className="space-y-2">
            <Label>Commission Type</Label>
            <Select value={commissionType} onValueChange={setCommissionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="flat">Flat Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Periods */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Periods</Label>
              <Button type="button" size="sm" variant="outline" onClick={addPeriod}>
                <Plus className="mr-1 h-3 w-3" /> Add Period
              </Button>
            </div>
            <div className="space-y-2">
              {periods.map((period, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={1}
                      placeholder="From"
                      value={period.from_payment}
                      onChange={(e) => updatePeriod(index, 'from_payment', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <span className="text-muted-foreground text-sm">to</span>
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={1}
                      placeholder="To"
                      value={period.to_payment}
                      onChange={(e) => updatePeriod(index, 'to_payment', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <span className="text-muted-foreground text-sm">@</span>
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Rate"
                      value={period.rate}
                      onChange={(e) => updatePeriod(index, 'rate', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {commissionType === 'percentage' ? '%' : '$'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removePeriod(index)}
                    disabled={periods.length <= 1}
                  >
                    <Trash2 className="h-3 w-3 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>End Behavior</Label>
            <Select value={endBehavior} onValueChange={setEndBehavior}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stop">Stop (no more commissions)</SelectItem>
                <SelectItem value="continue_last">Continue at last rate</SelectItem>
                <SelectItem value="custom_rate">Custom rate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {endBehavior === 'custom_rate' && (
            <div className="space-y-2">
              <Label htmlFor="end-rate">
                End Rate ({commissionType === 'percentage' ? '%' : '$'})
              </Label>
              <Input
                id="end-rate"
                type="number"
                min={0}
                step="0.01"
                value={endRate}
                onChange={(e) => setEndRate(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : schedule ? 'Update Schedule' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
