import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Clock, Moon, Users, Zap, Building2, CalendarClock } from 'lucide-react';
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

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;

  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
    if (canScroll) return current;
    current = current.parentElement;
  }

  return null;
}

interface Props {
  scheduleMode: ScheduleMode;
  scheduleConfigured: boolean;
  aiSchedule: BusinessHours | null;
  companyTimezone: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updates: {
    schedule_mode: ScheduleMode;
    ai_schedule: BusinessHours | null;
  }) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function ScheduleSection({
  scheduleMode, scheduleConfigured, aiSchedule, companyTimezone,
  isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [draftMode, setDraftMode] = useState<ScheduleMode>(scheduleMode);
  const [draftAiSchedule, setDraftAiSchedule] = useState<BusinessHours>(aiSchedule || getDefaultBusinessHours());
  const [saving, setSaving] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded) return;
    setDraftMode(scheduleMode);
    setDraftAiSchedule(aiSchedule || getDefaultBusinessHours());
  }, [scheduleMode, aiSchedule, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    const timeout = window.setTimeout(() => {
      const sectionNode = sectionRef.current;
      if (!sectionNode) return;

      const scrollParent = findScrollParent(sectionNode);
      if (scrollParent) {
        scrollParent.scrollTo({
          top: scrollParent.scrollHeight,
          behavior: 'smooth',
        });
        return;
      }

      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth',
      });
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [isExpanded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        schedule_mode: draftMode,
        ai_schedule: draftMode === 'custom' ? draftAiSchedule : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftMode(scheduleMode);
    setDraftAiSchedule(aiSchedule || getDefaultBusinessHours());
    onToggle();
  };

  const isConfigured = scheduleConfigured;

  const modeLabels: Record<ScheduleMode, string> = {
    always_on: 'Always on',
    business_hours: 'Business hours',
    custom: 'Custom schedule',
    when_away: 'When team is away',
    outside_hours: 'Outside business hours',
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
              <Zap className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium">Always On</p>
                <p className="text-xs text-muted-foreground">AI responds to every message, 24/7 — no downtime</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'business_hours'}
              onClick={() => setDraftMode('business_hours')}
            >
              <Building2 className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
              <div>
                <p className="text-sm font-medium">During Business Hours</p>
                <p className="text-xs text-muted-foreground">AI is active only during your company's business hours</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'outside_hours'}
              onClick={() => setDraftMode('outside_hours')}
            >
              <Moon className="h-4 w-4 mt-0.5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-sm font-medium">Outside Business Hours</p>
                <p className="text-xs text-muted-foreground">AI covers nights and weekends — your team handles business hours</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'when_away'}
              onClick={() => setDraftMode('when_away')}
            >
              <Users className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
              <div>
                <p className="text-sm font-medium">When Team is Away</p>
                <p className="text-xs text-muted-foreground">AI steps in only when all team members are set to Away</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draftMode === 'custom'}
              onClick={() => setDraftMode('custom')}
            >
              <CalendarClock className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-medium">Custom Schedule</p>
                <p className="text-xs text-muted-foreground">Define your own active hours — independent of company business hours</p>
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

        </div>
      </SectionCard>
    </div>
  );
}
