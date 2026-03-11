import { useEffect, useRef, useState } from 'react';
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
  scheduleMode: ScheduleMode;
  scheduleConfigured: boolean;
  aiSchedule: BusinessHours | null;
  outsideHoursMessage: string | null;
  companyTimezone: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updates: {
    schedule_mode: ScheduleMode;
    ai_schedule: BusinessHours | null;
    outside_hours_message: string | null;
  }) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function ScheduleSection({
  scheduleMode, scheduleConfigured, aiSchedule, outsideHoursMessage, companyTimezone,
  isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [draftMode, setDraftMode] = useState<ScheduleMode>(scheduleMode);
  const [draftAiSchedule, setDraftAiSchedule] = useState<BusinessHours>(aiSchedule || getDefaultBusinessHours());
  const [draftOutsideMsg, setDraftOutsideMsg] = useState(outsideHoursMessage || '');
  const [saving, setSaving] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded) return;
    setDraftMode(scheduleMode);
    setDraftAiSchedule(aiSchedule || getDefaultBusinessHours());
    setDraftOutsideMsg(outsideHoursMessage || '');
  }, [scheduleMode, aiSchedule, outsideHoursMessage, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    const timeout = window.setTimeout(() => {
      const sectionBottom = sectionRef.current
        ? sectionRef.current.getBoundingClientRect().bottom + window.scrollY
        : document.documentElement.scrollHeight;
      const targetScrollTop = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        sectionBottom - window.innerHeight
      );
      window.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [isExpanded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        schedule_mode: draftMode,
        ai_schedule: draftMode === 'custom' ? draftAiSchedule : null,
        outside_hours_message: draftMode !== 'always_on' ? (draftOutsideMsg.trim() || null) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftMode(scheduleMode);
    setDraftAiSchedule(aiSchedule || getDefaultBusinessHours());
    setDraftOutsideMsg(outsideHoursMessage || '');
    onToggle();
  };

  const isConfigured = scheduleConfigured;

  const modeLabels: Record<ScheduleMode, string> = {
    always_on: 'Always on',
    business_hours: 'Business hours',
    custom: 'Custom schedule',
  };
  const summaryText = scheduleConfigured
    ? modeLabels[scheduleMode]
    : 'Always on by default until you configure it';

  return (
    <div ref={sectionRef}>
      <SectionCard
        icon={<Clock className="h-4 w-4" />}
        title="AI Activity Schedule"
        isConfigured={isConfigured}
        summary={summaryText}
        statusLabel={scheduleConfigured ? modeLabels[scheduleMode] : undefined}
        headerNote={scheduleConfigured ? undefined : 'Defaults to Always on'}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        saving={saving}
        onSave={handleSave}
        onCancel={handleToggle}
        showSaveAsDefault={showSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={onSaveAsDefaultChange}
      >
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
                <p className="text-xs text-muted-foreground">AI follows your company's business hours</p>
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
      </SectionCard>
    </div>
  );
}
