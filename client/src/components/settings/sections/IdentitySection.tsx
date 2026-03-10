import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import SectionCard from './SectionCard';

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

  const update = (updates: Partial<ProfileData>) => setDraft((prev) => ({ ...prev, ...updates }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        use_case: 'business',
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

  const isConfigured = !!profileData.business_name;

  const summaryText = isConfigured
    ? [
        profileData.business_name,
        profileData.business_type,
      ].filter(Boolean).join(' · ')
    : 'Tell us about your business';

  return (
    <SectionCard
      icon={<Briefcase className="h-4 w-4" />}
      title="Business Details"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      canSave={true}
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Business Name</Label>
            <Input
              value={draft.business_name || ''}
              onChange={(e) => update({ business_name: e.target.value })}
              placeholder="e.g. Acme Corp"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Business Type</Label>
            <Input
              value={draft.business_type || ''}
              onChange={(e) => update({ business_type: e.target.value })}
              placeholder="e.g. Restaurant, E-commerce, Consulting"
              className="h-9"
            />
          </div>
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
      </div>
    </SectionCard>
  );
}
