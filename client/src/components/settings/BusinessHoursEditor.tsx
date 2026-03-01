import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Copy, Plus, X } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');

// Generate all times in 5-min increments: "00:00" .. "23:55"
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 5) {
    const value = `${pad(h)}:${pad(m)}`;
    const hour12 = h % 12 || 12;
    const period = h < 12 ? 'AM' : 'PM';
    const label = `${hour12}:${pad(m)} ${period}`;
    TIME_OPTIONS.push({ value, label });
  }
}

function formatTime(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const hour12 = h % 12 || 12;
  const period = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${pad(m)} ${period}`;
}

function TimePicker({ value, onChange, disabled }: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-8 cursor-pointer items-center rounded-md border bg-background px-3 text-sm whitespace-nowrap hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formatTime(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[120px] p-0">
        <div className="max-h-56 overflow-y-auto py-1">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-accent ${
                opt.value === value ? 'bg-accent/50 font-medium' : ''
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface TimeSlot {
  open: string;
  close: string;
}

export interface DaySchedule {
  enabled: boolean;
  open: string;
  close: string;
  slots?: TimeSlot[];
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

/** Get the effective slots for a day (backwards compatible with single open/close) */
export function getDaySlots(day: DaySchedule): TimeSlot[] {
  if (day.slots && day.slots.length > 0) return day.slots;
  return [{ open: day.open, close: day.close }];
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
  const [copySource, setCopySource] = useState<keyof BusinessHours | null>(null);
  const [selectedDays, setSelectedDays] = useState<Set<keyof BusinessHours>>(new Set());

  const getSlots = (day: keyof BusinessHours): TimeSlot[] => getDaySlots(value[day]);

  const setSlots = (day: keyof BusinessHours, slots: TimeSlot[]) => {
    const schedule = value[day];
    // Keep open/close in sync with the first slot for backwards compat
    const first = slots[0];
    onChange({
      ...value,
      [day]: {
        ...schedule,
        open: first.open,
        close: first.close,
        slots: slots.length > 1 ? slots : undefined,
      },
    });
  };

  const updateDay = (day: keyof BusinessHours, patch: Partial<DaySchedule>) => {
    onChange({ ...value, [day]: { ...value[day], ...patch } });
  };

  const updateSlot = (day: keyof BusinessHours, index: number, patch: Partial<TimeSlot>) => {
    const slots = getSlots(day).map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSlots(day, slots);
  };

  const addSlot = (day: keyof BusinessHours) => {
    const slots = getSlots(day);
    const lastClose = slots[slots.length - 1].close;
    // Default new slot starts 1h after the last close
    const [h, m] = lastClose.split(':').map(Number);
    const startMin = Math.min(h * 60 + m + 60, 23 * 60);
    const endMin = Math.min(startMin + 120, 23 * 60 + 59);
    const pad = (n: number) => String(n).padStart(2, '0');
    const newOpen = `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`;
    const newClose = `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`;
    setSlots(day, [...slots, { open: newOpen, close: newClose }]);
  };

  const removeSlot = (day: keyof BusinessHours, index: number) => {
    const slots = getSlots(day).filter((_, i) => i !== index);
    if (slots.length === 0) return; // never remove the last slot
    setSlots(day, slots);
  };

  const openCopyPopover = (sourceDay: keyof BusinessHours) => {
    setCopySource(sourceDay);
    setSelectedDays(new Set(DAYS.filter((d) => d !== sourceDay)));
  };

  const toggleDay = (day: keyof BusinessHours) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const applyCopy = () => {
    if (!copySource) return;
    const source = value[copySource];
    const sourceSlots = getSlots(copySource);
    const updated = { ...value };
    for (const day of selectedDays) {
      updated[day] = {
        ...source,
        slots: sourceSlots.length > 1 ? sourceSlots.map((s) => ({ ...s })) : undefined,
      };
    }
    onChange(updated);
    setCopySource(null);
  };

  return (
    <div className="space-y-1">
      {DAYS.map((day) => {
        const schedule = value[day];
        const slots = getSlots(day);
        return (
          <div
            key={day}
            className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/50"
          >
            <Checkbox
              checked={schedule.enabled}
              onCheckedChange={(checked) => updateDay(day, { enabled: !!checked })}
              disabled={disabled}
              className="mt-1.5"
            />
            <span className="mt-1 w-10 text-sm font-medium">{DAY_LABELS[day]}</span>
            {schedule.enabled ? (
              <div className="flex flex-1 flex-col gap-1.5">
                {slots.map((slot, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <TimePicker
                      value={slot.open}
                      onChange={(v) => updateSlot(day, i, { open: v })}
                      disabled={disabled}
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <TimePicker
                      value={slot.close}
                      onChange={(v) => updateSlot(day, i, { close: v })}
                      disabled={disabled}
                    />
                    {i === 0 ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground"
                          onClick={() => addSlot(day)}
                          disabled={disabled}
                          title="Add time slot"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Popover
                          open={copySource === day}
                          onOpenChange={(open: boolean) => { if (!open) setCopySource(null); }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground"
                              onClick={() => openCopyPopover(day)}
                              disabled={disabled}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent side="right" align="start" className="w-48 p-3">
                            <p className="mb-2 text-xs font-medium">Copy to:</p>
                            <div className="space-y-1.5">
                              {DAYS.filter((d) => d !== day).map((d) => (
                                <label key={d} className="flex cursor-pointer items-center gap-2">
                                  <Checkbox
                                    checked={selectedDays.has(d)}
                                    onCheckedChange={() => toggleDay(d)}
                                  />
                                  <span className="text-sm">{DAY_LABELS[d]}</span>
                                </label>
                              ))}
                            </div>
                            <Button
                              size="sm"
                              className="mt-3 w-full"
                              onClick={applyCopy}
                              disabled={selectedDays.size === 0}
                            >
                              Apply
                            </Button>
                          </PopoverContent>
                        </Popover>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeSlot(day, i)}
                        disabled={disabled}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="mt-1 text-sm italic text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
