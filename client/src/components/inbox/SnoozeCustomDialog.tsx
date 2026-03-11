import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Clock } from 'lucide-react';

interface SnoozeCustomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: string) => void;
}

export default function SnoozeCustomDialog({ open, onOpenChange, onSnooze }: SnoozeCustomDialogProps) {
  const [customDate, setCustomDate] = useState<string>('');

  const handleSnooze = () => {
    if (!customDate) return;
    const date = new Date(customDate);
    if (date <= new Date()) return;
    onSnooze(date.toISOString());
    onOpenChange(false);
    setCustomDate('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setCustomDate(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">Snooze until</DialogTitle>
        </DialogHeader>
        <DateTimePicker
          minDate={new Date()}
          onChange={(date) => setCustomDate(date.toISOString())}
        />
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleSnooze}
          disabled={!customDate || new Date(customDate) <= new Date()}
        >
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          Snooze
        </Button>
      </DialogContent>
    </Dialog>
  );
}
