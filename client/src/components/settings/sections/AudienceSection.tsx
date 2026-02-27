import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Users, X, Plus } from 'lucide-react';
import type { ProfileData, AudienceSegment } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
import SectionCard from './SectionCard';

const PRESET_AUDIENCES = [
  { label: 'New customers', description: 'People inquiring about products or services' },
  { label: 'Existing customers', description: 'Support, orders, and follow-ups' },
  { label: 'Leads & prospects', description: 'Potential customers exploring options' },
  { label: 'Partners & suppliers', description: 'Business partners and vendors' },
  { label: 'Job applicants', description: 'People asking about job openings' },
  { label: 'General inquiries', description: 'General questions and information requests' },
];

interface Props {
  profileData: ProfileData;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (data: Partial<ProfileData>) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

function migrateAudiences(profileData: ProfileData): AudienceSegment[] {
  if (profileData.audiences && profileData.audiences.length > 0) {
    return profileData.audiences;
  }
  if (profileData.target_audience) {
    return [{ label: 'General', description: profileData.target_audience }];
  }
  return [];
}

export default function AudienceSection({
  profileData, isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [audiences, setAudiences] = useState<AudienceSegment[]>(() => migrateAudiences(profileData));
  const [commonTopics, setCommonTopics] = useState(profileData.common_topics || '');
  const [customLabel, setCustomLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        audiences,
        common_topics: commonTopics.trim() || undefined,
        target_audience: undefined, // clear deprecated field
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setAudiences(migrateAudiences(profileData));
    setCommonTopics(profileData.common_topics || '');
    setCustomLabel('');
    onToggle();
  };

  const isSelected = (label: string) => audiences.some((a) => a.label === label);

  const togglePreset = (preset: typeof PRESET_AUDIENCES[number]) => {
    if (isSelected(preset.label)) {
      setAudiences((prev) => prev.filter((a) => a.label !== preset.label));
    } else {
      setAudiences((prev) => [...prev, { label: preset.label, description: '' }]);
    }
  };

  const updateDescription = (label: string, description: string) => {
    setAudiences((prev) =>
      prev.map((a) => (a.label === label ? { ...a, description } : a))
    );
  };

  const addCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed || isSelected(trimmed)) return;
    setAudiences((prev) => [...prev, { label: trimmed, description: '' }]);
    setCustomLabel('');
  };

  const removeAudience = (label: string) => {
    setAudiences((prev) => prev.filter((a) => a.label !== label));
  };

  const isConfigured = (profileData.audiences && profileData.audiences.length > 0) || !!profileData.target_audience;

  const summaryText = isConfigured
    ? (profileData.audiences || []).map((a) => a.label).join(', ') || profileData.target_audience?.slice(0, 80)
    : 'Define who messages this channel';

  return (
    <SectionCard
      icon={<Users className="h-4 w-4" />}
      title="Audience"
      isConfigured={!!isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      canSave={audiences.length > 0}
      showSaveAsDefault={showSaveAsDefault}
      saveAsDefault={saveAsDefault}
      onSaveAsDefaultChange={onSaveAsDefaultChange}
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">
            Select who will be messaging this channel. Add a description for each to help the AI respond better.
          </p>
        </div>

        {/* Preset checkboxes */}
        <div className="grid gap-2">
          {PRESET_AUDIENCES.map((preset) => {
            const selected = isSelected(preset.label);
            return (
              <div key={preset.label}>
                <button
                  type="button"
                  onClick={() => togglePreset(preset)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'
                    )}
                  >
                    {selected && <span className="text-[10px]">✓</span>}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{preset.label}</p>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  </div>
                </button>
                {selected && (
                  <div className="mt-1.5 ml-7">
                    <Input
                      value={audiences.find((a) => a.label === preset.label)?.description || ''}
                      onChange={(e) => updateDescription(preset.label, e.target.value)}
                      placeholder="What do they typically ask about?"
                      className="h-8 text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Custom audiences */}
        {audiences.filter((a) => !PRESET_AUDIENCES.some((p) => p.label === a.label)).map((custom) => (
          <div key={custom.label} className="flex items-start gap-2 rounded-lg border border-primary bg-primary/5 p-3">
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-medium">{custom.label}</p>
              <Input
                value={custom.description || ''}
                onChange={(e) => updateDescription(custom.label, e.target.value)}
                placeholder="What do they typically ask about?"
                className="h-8 text-xs"
              />
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeAudience(custom.label)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}

        {/* Add custom */}
        <div className="flex items-center gap-2">
          <Input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Add custom audience type..."
            className="h-8 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          />
          <Button variant="outline" size="sm" onClick={addCustom} disabled={!customLabel.trim()} className="h-8 shrink-0">
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>

        {/* Common topics */}
        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs">Common Topics (optional)</Label>
          <textarea
            value={commonTopics}
            onChange={(e) => setCommonTopics(e.target.value)}
            rows={3}
            placeholder="What do people usually ask about? e.g. Pricing, product availability, delivery times, return policy..."
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
    </SectionCard>
  );
}
