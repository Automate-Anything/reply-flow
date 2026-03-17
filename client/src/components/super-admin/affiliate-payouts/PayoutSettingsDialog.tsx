import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface PayoutSettings {
  id: string;
  min_payout_cents: number;
  payout_day_of_month: number;
  updated_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PayoutSettingsDialog({ open, onOpenChange }: Props) {
  const [minPayoutDollars, setMinPayoutDollars] = useState('');
  const [payoutDay, setPayoutDay] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      api.get<{ settings: PayoutSettings }>('/affiliate/admin/payout-settings')
        .then(({ data }) => {
          setMinPayoutDollars((data.settings.min_payout_cents / 100).toString());
          setPayoutDay(data.settings.payout_day_of_month.toString());
        })
        .catch(() => toast.error('Failed to load payout settings'))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSave = async () => {
    const minCents = Math.round(parseFloat(minPayoutDollars) * 100);
    const day = parseInt(payoutDay);

    if (isNaN(minCents) || minCents < 0) {
      toast.error('Invalid minimum payout amount');
      return;
    }
    if (isNaN(day) || day < 1 || day > 28) {
      toast.error('Payout day must be between 1 and 28');
      return;
    }

    setSaving(true);
    try {
      await api.put('/affiliate/admin/payout-settings', {
        min_payout_cents: minCents,
        payout_day_of_month: day,
      });
      toast.success('Payout settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save payout settings');
    } finally {
      setSaving(false);
    }
  };

  // Generate day options 1-28
  const dayOptions = Array.from({ length: 28 }, (_, i) => i + 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payout Settings</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading...</p>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="min-payout">Minimum Payout Amount ($)</Label>
              <Input
                id="min-payout"
                type="number"
                min={0}
                step="0.01"
                value={minPayoutDollars}
                onChange={(e) => setMinPayoutDollars(e.target.value)}
                placeholder="e.g. 50.00"
              />
              <p className="text-xs text-muted-foreground">
                Affiliates must earn at least this amount before a payout is generated.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Payout Day of Month</Label>
              <Select value={payoutDay} onValueChange={setPayoutDay}>
                <SelectTrigger>
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent>
                  {dayOptions.map((day) => (
                    <SelectItem key={day} value={day.toString()}>
                      {day}{(day >= 11 && day <= 13) ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
