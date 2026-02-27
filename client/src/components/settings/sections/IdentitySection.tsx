import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase, User, Building2 } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
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
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function IdentitySection({
  profileData, isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [draft, setDraft] = useState<ProfileData>({ ...profileData });
  const [saving, setSaving] = useState(false);

  const update = (updates: Partial<ProfileData>) => setDraft((prev) => ({ ...prev, ...updates }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        use_case: draft.use_case,
        business_name: draft.business_name,
        business_type: draft.business_type,
        business_description: draft.business_description,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft({ ...profileData });
    onToggle();
  };

  const isConfigured = !!profileData.use_case;

  const summaryText = isConfigured
    ? [
        profileData.use_case?.charAt(0).toUpperCase() + profileData.use_case?.slice(1),
        profileData.business_name,
        profileData.business_description?.slice(0, 80),
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
      showSaveAsDefault={showSaveAsDefault}
      saveAsDefault={saveAsDefault}
      onSaveAsDefaultChange={onSaveAsDefaultChange}
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">What will this channel be used for?</p>
        </div>

        <div className="grid gap-2">
          {USE_CASE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ use_case: opt.value })}
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

        {(draft.use_case === 'business' || draft.use_case === 'organization') && (
          <div className="space-y-3 border-t pt-3">
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
          <div className="space-y-1.5 border-t pt-3">
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
      </div>
    </SectionCard>
  );
}
