import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';

export type ScheduleMode = 'always_on' | 'business_hours' | 'custom';

export interface AudienceSegment {
  label: string;
  description?: string;
}

// ── Response Flow types ──────────────────────────────

export interface CommunicationStyle {
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  response_length?: 'concise' | 'moderate' | 'detailed';
  emoji_usage?: 'none' | 'minimal' | 'moderate';
}

export interface ScenarioKBAttachment {
  kb_id: string;
  instructions?: string;
}

/** Unified KB attachment type used by KBPicker */
export type KBAttachment = ScenarioKBAttachment;

export interface Scenario {
  id: string;
  label: string;
  detection_criteria: string;
  do_not_respond?: boolean;

  // Instructions
  goal?: string;
  instructions?: string;
  context?: string;

  // Knowledge base attachments
  kb_attachments?: ScenarioKBAttachment[];

  // Guardrails
  rules?: string;
  example_response?: string;

  // Escalation
  escalation_trigger?: string;
  escalation_message?: string;

  // Style overrides
  tone?: CommunicationStyle['tone'];
  response_length?: CommunicationStyle['response_length'];
  emoji_usage?: CommunicationStyle['emoji_usage'];

  // DEPRECATED — kept for migration from old data
  response_rules?: string;
  escalation_rules?: string;
}

export type FallbackMode = 'respond_basics' | 'respond_custom' | 'human_handle';

export interface ResponseFlow {
  default_style: CommunicationStyle;
  scenarios: Scenario[];
  fallback_mode: FallbackMode;
  fallback_style?: CommunicationStyle;
  human_phone?: string;
  fallback_kb_attachments?: ScenarioKBAttachment[];
}

// ── Profile data ────────────────────────────────────

export interface ProfileData {
  // Business Details
  use_case?: 'business';
  business_name?: string;
  business_type?: string;
  business_description?: string;
  // Language (global)
  language_preference?: 'match_customer' | string;
  // Scenario-based response flow
  response_flow?: ResponseFlow;
  // DEPRECATED — kept for backward compat with old flat fields
  audiences?: AudienceSegment[];
  /** @deprecated Use audiences instead */
  target_audience?: string;
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  response_length?: 'concise' | 'moderate' | 'detailed';
  emoji_usage?: 'none' | 'minimal' | 'moderate';
  escalation_rules?: string;
}

export interface CompanyAIProfile {
  is_enabled: boolean;
  profile_data: ProfileData;
  max_tokens: number;
  schedule_mode: ScheduleMode;
  ai_schedule: BusinessHours | null;
  outside_hours_message: string | null;
}

const DEFAULT_PROFILE: CompanyAIProfile = {
  is_enabled: false,
  profile_data: {},
  max_tokens: 500,
  schedule_mode: 'always_on',
  ai_schedule: null,
  outside_hours_message: null,
};

export function useCompanyAI() {
  const [profile, setProfile] = useState<CompanyAIProfile>(DEFAULT_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await api.get('/ai/profile');
      setProfile(data.profile);
    } catch (err) {
      console.error('Failed to fetch AI profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    setLoadingProfile(true);
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(
    async (updates: Partial<CompanyAIProfile>) => {
      const { data } = await api.put('/ai/profile', updates);
      setProfile(data.profile);
      return data.profile;
    },
    []
  );

  return {
    profile,
    loadingProfile,
    updateProfile,
    refetchProfile: fetchProfile,
  };
}
