import { useState } from 'react';
import { Globe } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { OptionButton } from '../response-flow/StyleFields';
import LanguageSelect from '../response-flow/LanguageSelect';
import SectionCard from './SectionCard';

interface Props {
  profileData: ProfileData;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (data: Partial<ProfileData>) => Promise<void>;
}

export default function LanguageSection({
  profileData, isExpanded, onToggle, onSave,
}: Props) {
  const [draft, setDraft] = useState(profileData.language_preference ?? 'match_customer');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ language_preference: draft });
      onToggle();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft(profileData.language_preference ?? 'match_customer');
    onToggle();
  };

  const currentValue = profileData.language_preference;
  const isConfigured = !!currentValue;

  const summaryText = !currentValue
    ? 'Choose a response language'
    : currentValue === 'match_customer'
      ? 'Match customer language'
      : currentValue;

  return (
    <SectionCard
      icon={<Globe className="h-4 w-4" />}
      title="Response Language"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      canSave={true}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Choose which language your agent responds in.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <OptionButton
            selected={draft === 'match_customer'}
            onClick={() => setDraft('match_customer')}
          >
            <div>
              <p className="text-xs font-medium">Match customer</p>
              <p className="text-xs text-muted-foreground">Respond in their language</p>
            </div>
          </OptionButton>
          <OptionButton
            selected={draft !== 'match_customer'}
            onClick={() => setDraft(prev => prev === 'match_customer' ? 'English' : prev)}
          >
            <div>
              <p className="text-xs font-medium">Specific language</p>
              <p className="text-xs text-muted-foreground">Always use one language</p>
            </div>
          </OptionButton>
        </div>
        {draft !== 'match_customer' && (
          <LanguageSelect
            value={draft}
            onChange={setDraft}
          />
        )}
      </div>
    </SectionCard>
  );
}
