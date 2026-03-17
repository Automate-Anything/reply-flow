import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { PlanGate } from '@/components/auth/PlanGate';
import type { ProfileData, CommunicationStyle, ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import { useDebugMode } from '@/hooks/useDebugMode';
import ResponseFlowSection from './response-flow/ResponseFlowSection';
import FallbackToggle from './response-flow/FallbackToggle';
import StyleSection from './sections/StyleSection';
import AgentKBSection from './sections/AgentKBSection';
import LanguageSection from './sections/LanguageSection';
import { useResponseFlow } from './response-flow/useResponseFlow';
import PromptPreviewPanel from './PromptPreviewPanel';

interface Props {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
  agentId?: string;
}

export default function AIAgentSections({ profileData, onSave, agentId }: Props) {
  const { knowledgeBases } = useCompanyKB();
  const { debugMode } = useDebugMode();

  // Response flow state (used by Response Flow tab, Fallback tab, and as source of truth for defaults)
  const {
    flow, dirty,
    addScenario, updateScenario, removeScenario,
    setFallbackMode, setFallbackStyle, reset, clearDirty,
  } = useResponseFlow(profileData);

  useFormDirtyGuard(dirty);

  // ── Save helpers ──

  /** Save arbitrary profile fields (used by LanguageSection) */
  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, onSave]
  );

  /** Save communication style to response_flow.default_style.
   *  Reads base flow from profileData (not the hook's flow) to avoid
   *  accidentally persisting unsaved changes from other tabs. */
  const saveStyle = useCallback(
    async (style: CommunicationStyle) => {
      const baseFlow = profileData.response_flow ?? flow;
      const updatedFlow = { ...baseFlow, default_style: style };
      const merged = { ...profileData, response_flow: updatedFlow };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, flow, onSave]
  );

  /** Save agent-level KB attachments and mode to response_flow.
   *  Reads base flow from profileData (not the hook's flow) to avoid
   *  accidentally persisting unsaved changes from other tabs. */
  const saveAgentKB = useCallback(
    async (kbAttachments: ScenarioKBAttachment[], mode: 'always' | 'fallback') => {
      const baseFlow = profileData.response_flow ?? flow;
      const updatedFlow = {
        ...baseFlow,
        fallback_kb_attachments: kbAttachments.length > 0 ? kbAttachments : undefined,
        agent_kb_mode: mode,
      };
      const merged = { ...profileData, response_flow: updatedFlow };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, flow, onSave]
  );

  // ── Fallback tab save (still uses shared flow state) ──

  const [savingFallback, setSavingFallback] = useState(false);

  const handleSaveFallback = useCallback(async () => {
    setSavingFallback(true);
    try {
      const merged = { ...profileData, response_flow: flow };
      await onSave({ profile_data: merged });
      clearDirty();
      toast.success('Saved');
    } finally {
      setSavingFallback(false);
    }
  }, [profileData, flow, onSave, clearDirty]);

  const fallbackSaveFooter = dirty ? (
    <div className="flex items-center justify-end border-t pt-4 gap-2">
      <Button variant="outline" size="sm" onClick={reset}>
        Cancel
      </Button>
      <PlanGate>
        <Button size="sm" onClick={handleSaveFallback} disabled={savingFallback}>
          {savingFallback && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </PlanGate>
    </div>
  ) : null;

  // ── Accordion expand state for Defaults tab ──

  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const toggleStep = (step: string) =>
    setExpandedStep((prev) => (prev === step ? null : step));

  return (
    <Tabs defaultValue="defaults">
      <TabsList className="w-full">
        <TabsTrigger value="defaults" className="flex-1">Defaults</TabsTrigger>
        <TabsTrigger value="response-flow" className="flex-1">Response Flow</TabsTrigger>
        <TabsTrigger value="fallback" className="flex-1">Fallback Behavior</TabsTrigger>
      </TabsList>

      {/* ── Tab 1: Defaults ── */}
      <TabsContent value="defaults" className="space-y-3 pt-3">
        <p className="text-xs text-muted-foreground">
          Configure your agent's default behavior. These apply to all conversations unless overridden by a scenario.
        </p>

        {/* Step 1: Communication Style */}
        <StyleSection
          style={flow.default_style}
          isExpanded={expandedStep === 'style'}
          onToggle={() => toggleStep('style')}
          onSave={saveStyle}
        />

        {/* Step 2: Knowledge Base */}
        <AgentKBSection
          kbAttachments={flow.fallback_kb_attachments ?? []}
          agentKBMode={flow.agent_kb_mode ?? 'fallback'}
          knowledgeBases={knowledgeBases}
          isExpanded={expandedStep === 'kb'}
          onToggle={() => toggleStep('kb')}
          onSave={saveAgentKB}
        />

        {/* Step 3: Language Preferences */}
        <LanguageSection
          profileData={profileData}
          isExpanded={expandedStep === 'lang'}
          onToggle={() => toggleStep('lang')}
          onSave={saveProfileFields}
        />
      </TabsContent>

      {/* ── Tab 2: Response Flow ── */}
      <TabsContent value="response-flow" className="space-y-5 pt-1">
        <p className="text-xs text-muted-foreground">
          Define scenarios to handle specific types of messages with tailored responses, knowledge, and instructions.
        </p>
        <ResponseFlowSection
          profileData={profileData}
          agentId={agentId}
          flow={flow}
          knowledgeBases={knowledgeBases}
          addScenario={addScenario}
          updateScenario={updateScenario}
          removeScenario={removeScenario}
          onAutoSave={async (updatedFlow) => {
            const merged = { ...profileData, response_flow: updatedFlow };
            await onSave({ profile_data: merged });
            clearDirty();
          }}
        />
        {debugMode && (
          <PromptPreviewPanel profileData={{ ...profileData, response_flow: flow }} agentId={agentId} />
        )}
      </TabsContent>

      {/* ── Tab 3: Fallback Behavior ── */}
      <TabsContent value="fallback" className="space-y-4 pt-1">
        <p className="text-sm text-muted-foreground">
          How should your agent respond when a message doesn't match any scenario?
        </p>
        <FallbackToggle
          mode={flow.fallback_mode}
          onChange={setFallbackMode}
          fallbackStyle={flow.fallback_style}
          onFallbackStyleChange={setFallbackStyle}
        />
        {fallbackSaveFooter}
      </TabsContent>
    </Tabs>
  );
}
