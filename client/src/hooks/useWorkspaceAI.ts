import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface ProfileData {
  use_case?: 'business' | 'personal' | 'organization';
  business_name?: string;
  business_type?: string;
  business_description?: string;
  target_audience?: string;
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  language_preference?: 'match_customer' | string;
  response_length?: 'concise' | 'moderate' | 'detailed';
  response_rules?: string;
  greeting_message?: string;
}

export interface WorkspaceAIProfile {
  is_enabled: boolean;
  profile_data: ProfileData;
  max_tokens: number;
}

const DEFAULT_PROFILE: WorkspaceAIProfile = {
  is_enabled: false,
  profile_data: {},
  max_tokens: 500,
};

export function useWorkspaceAI(workspaceId: string | undefined) {
  const [profile, setProfile] = useState<WorkspaceAIProfile>(DEFAULT_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { data } = await api.get(`/ai/profile/${workspaceId}`);
      setProfile(data.profile);
    } catch (err) {
      console.error('Failed to fetch AI profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setProfile(DEFAULT_PROFILE);
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    fetchProfile();
  }, [fetchProfile, workspaceId]);

  const updateProfile = useCallback(
    async (updates: Partial<WorkspaceAIProfile>) => {
      if (!workspaceId) return;
      const { data } = await api.put(`/ai/profile/${workspaceId}`, updates);
      setProfile(data.profile);
      return data.profile;
    },
    [workspaceId]
  );

  return {
    profile,
    loadingProfile,
    updateProfile,
    refetchProfile: fetchProfile,
  };
}
