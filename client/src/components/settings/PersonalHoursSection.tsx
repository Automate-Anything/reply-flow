import { useState, useMemo } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import BusinessHoursEditor, {
  getDefaultBusinessHours,
  type BusinessHours,
} from '@/components/settings/BusinessHoursEditor';

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Asia/Kolkata',
      'Australia/Sydney',
    ];
  }
})();

export interface PersonalHoursSectionProps {
  timezone: string | null;
  companyTimezone: string;
  personalHours: BusinessHours | null;
  hoursControlAvailability: boolean;
  onSave: (updates: {
    timezone?: string | null;
    personal_hours?: BusinessHours | null;
    hours_control_availability?: boolean;
  }) => Promise<void>;
}

export default function PersonalHoursSection({
  timezone,
  companyTimezone,
  personalHours,
  hoursControlAvailability,
  onSave,
}: PersonalHoursSectionProps) {
  const [localTimezone, setLocalTimezone] = useState<string | null>(timezone);
  const [localHours, setLocalHours] = useState<BusinessHours | null>(personalHours);
  const [localHoursControl, setLocalHoursControl] = useState(hoursControlAvailability);

  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return TIMEZONES;
    const q = tzSearch.toLowerCase();
    return TIMEZONES.filter((tz) => tz.toLowerCase().includes(q));
  }, [tzSearch]);

  const hasChanges = useMemo(() => {
    if (localTimezone !== timezone) return true;
    if (localHoursControl !== hoursControlAvailability) return true;
    if (JSON.stringify(localHours) !== JSON.stringify(personalHours)) return true;
    return false;
  }, [localTimezone, timezone, localHoursControl, hoursControlAvailability, localHours, personalHours]);

  const handleToggleHoursControl = (checked: boolean) => {
    setLocalHoursControl(checked);
    if (checked && !localHours) {
      setLocalHours(getDefaultBusinessHours());
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        timezone: localTimezone,
        personal_hours: localHours,
        hours_control_availability: localHoursControl,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Timezone */}
      <div className="space-y-1.5">
        <Label>Your Timezone</Label>
        <p className="text-xs text-muted-foreground">
          Overrides the company timezone ({companyTimezone}) for your schedule. Leave as default to use the company's.
        </p>
        <Popover
          open={tzOpen}
          onOpenChange={(open) => {
            setTzOpen(open);
            if (!open) setTzSearch('');
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={tzOpen}
              className="w-full justify-between font-normal"
            >
              {localTimezone ?? `Company default (${companyTimezone})`}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <div className="border-b px-3 py-2">
              <Input
                placeholder="Search timezones..."
                value={tzSearch}
                onChange={(e) => setTzSearch(e.target.value)}
                className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {/* Use company default option */}
              {!tzSearch && (
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                    localTimezone === null && 'bg-accent'
                  )}
                  onClick={() => {
                    setLocalTimezone(null);
                    setTzOpen(false);
                    setTzSearch('');
                  }}
                >
                  <Check className={cn('h-4 w-4 shrink-0', localTimezone === null ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-muted-foreground">Use company default ({companyTimezone})</span>
                </button>
              )}
              {filteredTimezones.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">No timezone found.</p>
              ) : (
                filteredTimezones.map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                      tz === localTimezone && 'bg-accent'
                    )}
                    onClick={() => {
                      setLocalTimezone(tz);
                      setTzOpen(false);
                      setTzSearch('');
                    }}
                  >
                    <Check className={cn('h-4 w-4 shrink-0', tz === localTimezone ? 'opacity-100' : 'opacity-0')} />
                    {tz}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Auto-manage availability toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="hours-control-availability" className="text-sm font-medium">
            Auto-manage availability
          </Label>
          <p className="text-xs text-muted-foreground">
            Automatically set you as Available or Away based on your working hours. You can still override manually — it resets the next day.
          </p>
        </div>
        <Switch
          id="hours-control-availability"
          checked={localHoursControl}
          onCheckedChange={handleToggleHoursControl}
        />
      </div>

      {/* Working hours editor — only shown when toggle is ON */}
      {localHoursControl && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Working Hours</Label>
          <BusinessHoursEditor
            value={localHours ?? getDefaultBusinessHours()}
            onChange={setLocalHours}
          />
        </div>
      )}

      {/* Save button — only shown when there are unsaved changes */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
