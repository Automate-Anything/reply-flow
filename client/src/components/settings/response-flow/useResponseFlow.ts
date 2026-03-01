import { useState, useCallback } from 'react';
import type { ProfileData, ResponseFlow, Scenario, CommunicationStyle, FallbackMode } from '@/hooks/useCompanyAI';

const DEFAULT_STYLE: CommunicationStyle = {
  tone: 'friendly',
  response_length: 'moderate',
  emoji_usage: 'minimal',
};

/**
 * Converts old flat ProfileData fields into a ResponseFlow object.
 * Runs once when user first opens Response Flow on a legacy profile.
 */
export function migrateFromFlat(profile: ProfileData): ResponseFlow {
  const escalation = profile.escalation_rules?.trim();
  const rules = profile.response_rules?.trim();
  const combinedRules = [rules, escalation ? `Escalation: ${escalation}` : '']
    .filter(Boolean)
    .join('\n\n') || undefined;

  return {
    default_style: {
      tone: profile.tone as CommunicationStyle['tone'] ?? DEFAULT_STYLE.tone,
      response_length: profile.response_length as CommunicationStyle['response_length'] ?? DEFAULT_STYLE.response_length,
      emoji_usage: profile.emoji_usage as CommunicationStyle['emoji_usage'] ?? DEFAULT_STYLE.emoji_usage,
    },
    greeting_message: profile.greeting_message?.trim() || undefined,
    response_rules: combinedRules,
    topics_to_avoid: profile.topics_to_avoid?.trim() || undefined,
    scenarios: [],
    fallback_mode: 'respond_basics',
  };
}

/**
 * Migrates old scenario fields to new ones.
 * response_rules → instructions, escalation_rules → escalation_trigger
 */
function migrateScenario(sc: Scenario): Scenario {
  if (!sc.response_rules && !sc.escalation_rules) return sc;
  return {
    ...sc,
    instructions: sc.instructions ?? sc.response_rules,
    escalation_trigger: sc.escalation_trigger ?? sc.escalation_rules,
    response_rules: undefined,
    escalation_rules: undefined,
  };
}

function migrateFlow(flow: ResponseFlow): ResponseFlow {
  const hasOldFields = flow.scenarios.some(
    (sc) => sc.response_rules || sc.escalation_rules
  );
  if (!hasOldFields) return flow;
  return {
    ...flow,
    scenarios: flow.scenarios.map(migrateScenario),
  };
}

let _idCounter = 0;
function generateId(): string {
  return `sc_${Date.now()}_${++_idCounter}`;
}

export function useResponseFlow(profileData: ProfileData) {
  const [flow, setFlow] = useState<ResponseFlow>(() => {
    const raw = profileData.response_flow ?? migrateFromFlat(profileData);
    return migrateFlow(raw);
  });
  const [dirty, setDirty] = useState(false);

  const updateFlow = useCallback((updates: Partial<ResponseFlow>) => {
    setFlow((prev) => ({ ...prev, ...updates }));
    setDirty(true);
  }, []);

  // ── Default style ──
  const updateDefaultStyle = useCallback((style: CommunicationStyle) => {
    updateFlow({ default_style: style });
  }, [updateFlow]);

  // ── Scenarios CRUD ──
  const addScenario = useCallback((label: string): Scenario => {
    const scenario: Scenario = {
      id: generateId(),
      label,
      detection_criteria: '',
    };
    setFlow((prev) => ({
      ...prev,
      scenarios: [...prev.scenarios, scenario],
    }));
    setDirty(true);
    return scenario;
  }, []);

  const updateScenario = useCallback((id: string, updates: Partial<Scenario>) => {
    setFlow((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    }));
    setDirty(true);
  }, []);

  const removeScenario = useCallback((id: string) => {
    setFlow((prev) => ({
      ...prev,
      scenarios: prev.scenarios.filter((s) => s.id !== id),
    }));
    setDirty(true);
  }, []);

  // ── Fallback ──
  const setFallbackMode = useCallback((mode: FallbackMode) => {
    updateFlow({ fallback_mode: mode });
  }, [updateFlow]);

  // ── Reset to saved state ──
  const reset = useCallback(() => {
    const raw = profileData.response_flow ?? migrateFromFlat(profileData);
    setFlow(migrateFlow(raw));
    setDirty(false);
  }, [profileData]);

  return {
    flow,
    dirty,
    updateFlow,
    updateDefaultStyle,
    addScenario,
    updateScenario,
    removeScenario,
    setFallbackMode,
    reset,
  };
}
