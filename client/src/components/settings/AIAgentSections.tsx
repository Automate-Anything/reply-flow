import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { ProfileData } from '@/hooks/useCompanyAI';
import IdentitySection from './sections/IdentitySection';
import ResponseFlowSection from './response-flow/ResponseFlowSection';

interface Props {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
  agentId?: string;
}

type SectionId = 'identity';

export default function AIAgentSections({ profileData, onSave, agentId }: Props) {
  const [expandedSection, setExpandedSection] = useState<SectionId | null>(null);

  const toggleSection = useCallback((section: SectionId) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  }, []);

  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
      setExpandedSection(null);
    },
    [profileData, onSave]
  );

  const saveResponseFlow = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, onSave]
  );

  return (
    <div className="space-y-3">
      <IdentitySection
        profileData={profileData}
        isExpanded={expandedSection === 'identity'}
        onToggle={() => toggleSection('identity')}
        onSave={saveProfileFields}
      />

      <ResponseFlowSection
        profileData={profileData}
        agentId={agentId}
        onSave={saveResponseFlow}
      />
    </div>
  );
}
