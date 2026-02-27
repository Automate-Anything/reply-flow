import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
}

export interface BusinessHours {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

const DAYS: (keyof BusinessHours)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const DAY_LABELS: Record<keyof BusinessHours, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

const DEFAULT_SCHEDULE: DaySchedule = { enabled: true, open: '09:00', close: '17:00' };

export function getDefaultBusinessHours(): BusinessHours {
  return {
    monday: { ...DEFAULT_SCHEDULE },
    tuesday: { ...DEFAULT_SCHEDULE },
    wednesday: { ...DEFAULT_SCHEDULE },
    thursday: { ...DEFAULT_SCHEDULE },
    friday: { ...DEFAULT_SCHEDULE },
    saturday: { enabled: false, open: '09:00', close: '17:00' },
    sunday: { enabled: false, open: '09:00', close: '17:00' },
  };
}

interface Props {
  value: BusinessHours;
  onChange: (hours: BusinessHours) => void;
  disabled?: boolean;
}

export default function BusinessHoursEditor({ value, onChange, disabled }: Props) {
  const updateDay = (day: keyof BusinessHours, patch: Partial<DaySchedule>) => {
    onChange({ ...value, [day]: { ...value[day], ...patch } });
  };

  const applyToAll = (sourceDay: keyof BusinessHours) => {
    const source = value[sourceDay];
    const updated = { ...value };
    for (const day of DAYS) {
      updated[day] = { ...source };
    }
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {DAYS.map((day) => {
        const schedule = value[day];
        return (
          <div
            key={day}
            className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/50"
          >
            <Checkbox
              checked={schedule.enabled}
              onCheckedChange={(checked) => updateDay(day, { enabled: !!checked })}
              disabled={disabled}
            />
            <span className="w-10 text-sm font-medium">{DAY_LABELS[day]}</span>
            {schedule.enabled ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={schedule.open}
                  onChange={(e) => updateDay(day, { open: e.target.value })}
                  disabled={disabled}
                  className="h-8 w-[120px] text-sm"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={schedule.close}
                  onChange={(e) => updateDay(day, { close: e.target.value })}
                  disabled={disabled}
                  className="h-8 w-[120px] text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Apply to all days"
                  onClick={() => applyToAll(day)}
                  disabled={disabled}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
