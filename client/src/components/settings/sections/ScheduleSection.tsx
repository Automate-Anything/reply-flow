import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Clock } from 'lucide-react';
import type { ScheduleMode } from '@/hooks/useCompanyAI';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';
import BusinessHoursEditor, { getDefaultBusinessHours } from '@/components/settings/BusinessHoursEditor';
import { cn } from '@/lib/utils';
import SectionCard from './SectionCard';

function OptionButton({ selected, onClick, children }: {
  selected: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  );
}

interface Props {
  businessHours: BusinessHours | null;
  scheduleMode: ScheduleMode;
  aiSchedule: BusinessHours | null;
  outsideHoursMessage: string | null;
  companyTimezone: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updates: {
    business_hours: BusinessHours;
    schedule_mode: ScheduleMode;
    ai_schedule: BusinessHours | null;
    outside_hours_message: string | null;
  }) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function ScheduleSection({
  businessHours, scheduleMode, aiSchedule, outsideHoursMessage, companyTimezone,
  isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [draftHours, setDraftHours] = useState<BusinessHours>(businessHours || getDefaultBusinessHours());
  const [draftMode, setDraftMode] = useState<ScheduleMode>(scheduleMode);
  const [draftAiSchedule, setDraftAiSchedule] = useState<BusinessHours>(aiSchedule || getDefaultBusinessHours());
  const [draftOutsideMsg, setDraftOutsideMsg] = useState(outsideHoursMessage || '');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        business_hours: draftHours,
        schedule_mode: draftMode,
        ai_schedule: draftMode === 'custom' ? draftAiSchedule : null,
        outside_hours_message: draftMode !== 'always_on' ? (draftOutsideMsg.trim() || null) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftHours(businessHours || getDefaultBusinessHours());
    setDraftMode(scheduleMode);
    setDraftAiSchedule(aiSchedule || getDefaultBusinessHours());
    setDraftOutsideMsg(outsideHoursMessage || '');
    setStep(0);
    onToggle();
  };

  const isConfigured = !!businessHours;

  const parts: string[] = [];
  const modeLabels: Record<ScheduleMode, string> = {
    always_on: 'Always on',
    business_hours: 'Business hours',
    custom: 'Custom schedule',
  };
  parts.push(modeLabels[scheduleMode]);
  if (businessHours) {
    const enabledDays = Object.entries(businessHours)
      .filter(([, s]) => s.enabled)
      .map(([day]) => day.charAt(0).toUpperCase() + day.slice(1, 3));
    if (enabledDays.length > 0) parts.push(enabledDays.join(', '));
  }
  const summaryText = isConfigured ? parts.join(' \u00b7 ') : 'Set business hours and AI schedule';

  return (
    <SectionCard
      icon={<Clock className="h-4 w-4" />}
      title="Schedule & Availability"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      step={step}
      totalSteps={2}
      onNext={() => setStep(1)}
      onBack={() => setStep(0)}
      showSaveAsDefault={showSaveAsDefault}
      saveAsDefault={saveAsDefault}
      onSaveAsDefaultChange={onSaveAsDefaultChange}
    >
      {step === 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Business Hours</Label>
          <p className="text-xs text-muted-foreground">
            Set when your team is available.
          </p>
          <BusinessHoursEditor
            value={draftHours}
            onChange={setDraftHours}
          />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">AI Activity Schedule</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Control when the AI agent is active. All times are in{' '}
              <span className="font-medium">{companyTimezone}</span> timezone.
            </p>
          </div>

          <div className="grid gap-2">
            <OptionButton
              selected={draftMode === 'always_on'}
              onClick={() => setDraftMode('always_on')}
            >
              <div>
                <p className="text-sm font-medium">Always On</p>
                <p className="text-xs text-muted-foreground">AI responds 24/7</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'business_hours'}
              onClick={() => setDraftMode('business_hours')}
            >
              <div>
                <p className="text-sm font-medium">Business Hours</p>
                <p className="text-xs text-muted-foreground">AI follows the business hours above</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'custom'}
              onClick={() => setDraftMode('custom')}
            >
              <div>
                <p className="text-sm font-medium">Custom Schedule</p>
                <p className="text-xs text-muted-foreground">Set a separate schedule for the AI</p>
              </div>
            </OptionButton>
          </div>

          {draftMode === 'custom' && (
            <div className="space-y-2 rounded-lg border p-3">
              <Label className="text-xs">AI Active Hours</Label>
              <BusinessHoursEditor
                value={draftAiSchedule}
                onChange={setDraftAiSchedule}
              />
            </div>
          )}

          {draftMode !== 'always_on' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Outside Hours Message (optional)</Label>
              <textarea
                value={draftOutsideMsg}
                onChange={(e) => setDraftOutsideMsg(e.target.value)}
                rows={2}
                placeholder="e.g. Thanks for reaching out! Our AI agent is currently offline. We'll get back to you during business hours."
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Sent automatically when someone messages outside the AI's active hours.
              </p>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
