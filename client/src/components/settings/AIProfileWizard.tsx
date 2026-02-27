import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { ProfileData, ScheduleMode } from '@/hooks/useCompanyAI';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';
import IdentitySection from './sections/IdentitySection';
import AudienceSection from './sections/AudienceSection';
import CommunicationSection from './sections/CommunicationSection';
import BehaviorSection from './sections/BehaviorSection';
import ScheduleSection from './sections/ScheduleSection';

export interface AIProfileShape {
  profile_data: ProfileData;
  schedule_mode: ScheduleMode;
  ai_schedule: BusinessHours | null;
  outside_hours_message: string | null;
  default_language: string;
  business_hours: BusinessHours | null;
}

interface Props {
  profile: AIProfileShape;
  onSave: (updates: Partial<AIProfileShape>) => Promise<unknown>;
  companyTimezone: string;
  onSaveAsDefault?: (updates: Partial<AIProfileShape>) => Promise<unknown>;
}

type SectionId = 'identity' | 'audience' | 'communication' | 'behavior' | 'schedule';

export default function AIProfileSections({ profile, onSave, companyTimezone, onSaveAsDefault }: Props) {
  const [expandedSection, setExpandedSection] = useState<SectionId | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const toggleSection = useCallback((section: SectionId) => {
    setExpandedSection((prev) => (prev === section ? null : section));
    setSaveAsDefault(false);
  }, []);

  // Merge section-specific profile_data changes into the full object
  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profile.profile_data, ...fields };
      const updates: Partial<AIProfileShape> = { profile_data: merged };
      await onSave(updates);
      if (saveAsDefault && onSaveAsDefault) {
        await onSaveAsDefault(updates);
      }
      toast.success(saveAsDefault ? 'Saved and set as default' : 'Saved');
      setExpandedSection(null);
      setSaveAsDefault(false);
    },
    [profile.profile_data, onSave, onSaveAsDefault, saveAsDefault]
  );

  const saveCommunication = useCallback(
    async (profileUpdates: Partial<ProfileData>, settingsUpdates: { default_language: string }) => {
      const merged = { ...profile.profile_data, ...profileUpdates };
      const updates: Partial<AIProfileShape> = {
        profile_data: merged,
        default_language: settingsUpdates.default_language,
      };
      await onSave(updates);
      if (saveAsDefault && onSaveAsDefault) {
        await onSaveAsDefault(updates);
      }
      toast.success(saveAsDefault ? 'Saved and set as default' : 'Saved');
      setExpandedSection(null);
      setSaveAsDefault(false);
    },
    [profile.profile_data, onSave, onSaveAsDefault, saveAsDefault]
  );

  const saveSchedule = useCallback(
    async (updates: {
      business_hours: BusinessHours;
      schedule_mode: ScheduleMode;
      ai_schedule: BusinessHours | null;
      outside_hours_message: string | null;
    }) => {
      const fullUpdates: Partial<AIProfileShape> = updates;
      await onSave(fullUpdates);
      if (saveAsDefault && onSaveAsDefault) {
        await onSaveAsDefault(fullUpdates);
      }
      toast.success(saveAsDefault ? 'Saved and set as default' : 'Saved');
      setExpandedSection(null);
      setSaveAsDefault(false);
    },
    [onSave, onSaveAsDefault, saveAsDefault]
  );

  return (
    <div className="space-y-3">
      <IdentitySection
        profileData={profile.profile_data}
        isExpanded={expandedSection === 'identity'}
        onToggle={() => toggleSection('identity')}
        onSave={saveProfileFields}
        showSaveAsDefault={!!onSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />

      <AudienceSection
        profileData={profile.profile_data}
        isExpanded={expandedSection === 'audience'}
        onToggle={() => toggleSection('audience')}
        onSave={saveProfileFields}
        showSaveAsDefault={!!onSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />

      <CommunicationSection
        profileData={profile.profile_data}
        defaultLanguage={profile.default_language}
        isExpanded={expandedSection === 'communication'}
        onToggle={() => toggleSection('communication')}
        onSave={saveCommunication}
        showSaveAsDefault={!!onSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />

      <BehaviorSection
        profileData={profile.profile_data}
        isExpanded={expandedSection === 'behavior'}
        onToggle={() => toggleSection('behavior')}
        onSave={saveProfileFields}
        showSaveAsDefault={!!onSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />

      <ScheduleSection
        businessHours={profile.business_hours}
        scheduleMode={profile.schedule_mode}
        aiSchedule={profile.ai_schedule}
        outsideHoursMessage={profile.outside_hours_message}
        companyTimezone={companyTimezone}
        isExpanded={expandedSection === 'schedule'}
        onToggle={() => toggleSection('schedule')}
        onSave={saveSchedule}
        showSaveAsDefault={!!onSaveAsDefault}
        saveAsDefault={saveAsDefault}
        onSaveAsDefaultChange={setSaveAsDefault}
      />
    </div>
  );
}
