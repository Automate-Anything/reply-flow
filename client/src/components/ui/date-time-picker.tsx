import { useState, useMemo } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createInTimezone, formatInTz } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';

interface DateTimePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
  minDate?: Date;
  className?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Extract hour (12h), minute, period from a Date in a given timezone. */
function timePartsInTz(date: Date, tz: string) {
  const h24 = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(date));
  const m = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: 'numeric' }).format(date));
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return { hour: h12, minute: m, period };
}


export function DateTimePicker({ value, onChange, minDate, className }: DateTimePickerProps) {
  const { companyTimezone: tz } = useSession();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value);
  const [hour, setHour] = useState<number>(value ? timePartsInTz(value, tz).hour : 9);
  const [minute, setMinute] = useState<number>(value ? timePartsInTz(value, tz).minute : 0);
  const [period, setPeriod] = useState<'AM' | 'PM'>(
    value ? timePartsInTz(value, tz).period : 'AM'
  );

  const buildDate = (calendarDate: Date, h: number, m: number, p: 'AM' | 'PM') => {
    // Calendar gives us a local-tz date for the selected day.
    // Extract year/month/day from it (these are already the intended calendar day).
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const day = calendarDate.getDate();
    let hours24 = h % 12;
    if (p === 'PM') hours24 += 12;
    return createInTimezone(tz, year, month, day, hours24, m);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
    onChange(buildDate(date, hour, minute, period));
  };

  const handleTimeChange = (h: number, m: number, p: 'AM' | 'PM') => {
    setHour(h);
    setMinute(m);
    setPeriod(p);
    if (selectedDate) {
      onChange(buildDate(selectedDate, h, m, p));
    }
  };

  const disabledDays = useMemo(() => {
    if (!minDate) return undefined;
    const before = new Date(minDate);
    before.setHours(0, 0, 0, 0);
    return { before };
  }, [minDate]);

  return (
    <div className={cn('flex flex-col', className)}>
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={handleDateSelect}
        disabled={disabledDays}
        className="p-0"
      />

      {/* Time picker */}
      <div className="border-t px-3 pb-3 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">{tz}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hour}
            onChange={(e) => handleTimeChange(Number(e.target.value), minute, period)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-sm font-medium text-muted-foreground">:</span>
          <select
            value={minute}
            onChange={(e) => handleTimeChange(hour, Number(e.target.value), period)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
          <div className="flex rounded-md border border-input">
            {(['AM', 'PM'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleTimeChange(hour, minute, p)}
                className={cn(
                  'h-8 px-2.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md',
                  period === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Display selected datetime in company timezone */}
        {selectedDate && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {formatInTz(buildDate(selectedDate, hour, minute, period), tz, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  );
}
