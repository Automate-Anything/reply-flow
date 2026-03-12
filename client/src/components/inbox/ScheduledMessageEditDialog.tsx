import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Clock, Loader2 } from 'lucide-react';
import { getTomorrowAt, getNextMondayAt } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import type { ScheduledMessage } from '@/hooks/useScheduledMessages';

function getSchedulePresets(tz?: string): { label: string; getDate: () => Date }[] {
  return [
    { label: 'In 1 hour', getDate: () => new Date(Date.now() + 3_600_000) },
    { label: 'In 3 hours', getDate: () => new Date(Date.now() + 3 * 3_600_000) },
    { label: 'Tomorrow 9am', getDate: () => getTomorrowAt(tz, 9) },
    { label: 'Next Monday 9am', getDate: () => getNextMondayAt(tz, 9) },
  ];
}

interface ScheduledMessageEditDialogProps {
  message: ScheduledMessage | null;
  onClose: () => void;
  onSave: (updates: { body?: string; scheduledFor?: string }) => Promise<void>;
}

export default function ScheduledMessageEditDialog({
  message,
  onClose,
  onSave,
}: ScheduledMessageEditDialogProps) {
  const { companyTimezone } = useSession();
  const [body, setBody] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (message) {
      setBody(message.message_body || '');
      setScheduledFor(message.scheduled_for);
    }
  }, [message]);

  const handleSave = async () => {
    if (!message) return;
    setSaving(true);
    try {
      const updates: { body?: string; scheduledFor?: string } = {};
      if (body !== (message.message_body || '')) updates.body = body;
      if (scheduledFor !== message.scheduled_for) updates.scheduledFor = scheduledFor;
      if (Object.keys(updates).length > 0) {
        await onSave(updates);
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const presets = getSchedulePresets(companyTimezone);

  return (
    <Dialog open={!!message} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Scheduled Message</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Message body..."
            />
          </div>

          <div className="space-y-2">
            <Label>Send at</Label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  variant={
                    scheduledFor && Math.abs(new Date(scheduledFor).getTime() - preset.getDate().getTime()) < 60_000
                      ? 'default'
                      : 'outline'
                  }
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setScheduledFor(preset.getDate().toISOString())}
                >
                  <Clock className="h-3 w-3" />
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="rounded-md border">
              <DateTimePicker
                value={scheduledFor ? new Date(scheduledFor) : undefined}
                minDate={new Date()}
                onChange={(date) => setScheduledFor(date.toISOString())}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !body.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
