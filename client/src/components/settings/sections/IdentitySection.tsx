import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase, User, Building2 } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
import { OptionButton } from '../response-flow/StyleFields';
import SectionCard from './SectionCard';

const USE_CASE_OPTIONS = [
  { value: 'business' as const, label: 'Business', icon: Briefcase, description: 'Customer support, sales, or services' },
  { value: 'personal' as const, label: 'Personal', icon: User, description: 'Personal messaging assistant' },
  { value: 'organization' as const, label: 'Organization', icon: Building2, description: 'Non-profit, community, or team' },
];

interface Props {
  profileData: ProfileData;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (data: Partial<ProfileData>) => Promise<void>;
}

export default function IdentitySection({
  profileData, isExpanded, onToggle, onSave,
}: Props) {
  const [draft, setDraft] = useState<ProfileData>({ ...profileData });
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  const update = (updates: Partial<ProfileData>) => setDraft((prev) => ({ ...prev, ...updates }));
  const selectedOption = USE_CASE_OPTIONS.find((opt) => opt.value === draft.use_case);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        use_case: draft.use_case,
        business_name: draft.business_name,
        business_type: draft.business_type,
        business_description: draft.business_description,
        language_preference: draft.language_preference,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft({ ...profileData });
    setStep(0);
    onToggle();
  };

  const isConfigured = !!profileData.use_case;

  const langLabel = profileData.language_preference === 'match_customer'
    ? 'Match customer'
    : profileData.language_preference;

  const summaryText = isConfigured
    ? [
        profileData.use_case ? profileData.use_case.charAt(0).toUpperCase() + profileData.use_case.slice(1) : undefined,
        profileData.business_name,
        langLabel,
      ].filter(Boolean).join(' \u00b7 ')
    : 'Define what this AI represents';

  return (
    <SectionCard
      icon={<Briefcase className="h-4 w-4" />}
      title="Identity"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      canSave={!!draft.use_case}
      step={step}
      totalSteps={2}
      onNext={() => setStep(1)}
      onBack={() => setStep(0)}
      canProceed={!!draft.use_case}
    >
      {step === 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">What will this AI agent be used for?</p>
          <div className="grid gap-2">
            {USE_CASE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  update({ use_case: opt.value });
                  setStep(1);
                }}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  draft.use_case === opt.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                )}
              >
                <opt.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {selectedOption && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <selectedOption.icon className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">{selectedOption.label}</p>
              <p className="text-xs text-muted-foreground">{selectedOption.description}</p>
            </div>
          )}

          {(draft.use_case === 'business' || draft.use_case === 'organization') && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {draft.use_case === 'business' ? 'Business Name' : 'Organization Name'}
                </Label>
                <Input
                  value={draft.business_name || ''}
                  onChange={(e) => update({ business_name: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="h-9"
                />
              </div>
              {draft.use_case === 'business' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Business Type</Label>
                  <Input
                    value={draft.business_type || ''}
                    onChange={(e) => update({ business_type: e.target.value })}
                    placeholder="e.g. Restaurant, E-commerce, Consulting"
                    className="h-9"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">About</Label>
                <textarea
                  value={draft.business_description || ''}
                  onChange={(e) => update({ business_description: e.target.value })}
                  rows={3}
                  placeholder="Briefly describe what you do..."
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {draft.use_case === 'personal' && (
            <div className="space-y-1.5">
              <Label className="text-xs">What do you want the AI to help with?</Label>
              <textarea
                value={draft.business_description || ''}
                onChange={(e) => update({ business_description: e.target.value })}
                rows={3}
                placeholder="e.g. Managing personal appointments, replying to friends..."
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          {/* Language Preference */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Response Language</Label>
            <div className="grid grid-cols-2 gap-2">
              <OptionButton
                selected={draft.language_preference === 'match_customer'}
                onClick={() => update({ language_preference: 'match_customer' })}
              >
                <div>
                  <p className="text-xs font-medium">Match customer</p>
                  <p className="text-xs text-muted-foreground">Respond in their language</p>
                </div>
              </OptionButton>
              <OptionButton
                selected={draft.language_preference !== undefined && draft.language_preference !== 'match_customer'}
                onClick={() => update({ language_preference: 'English' })}
              >
                <div>
                  <p className="text-xs font-medium">Specific language</p>
                  <p className="text-xs text-muted-foreground">Always use one language</p>
                </div>
              </OptionButton>
            </div>
            {draft.language_preference && draft.language_preference !== 'match_customer' && (
              <Input
                value={draft.language_preference}
                onChange={(e) => update({ language_preference: e.target.value })}
                placeholder="e.g. English, Spanish, Hebrew"
                className="mt-2 h-9"
              />
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
