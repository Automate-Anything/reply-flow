import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { PlanGate } from '@/components/auth/PlanGate';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import { useDebugMode } from '@/hooks/useDebugMode';
import ResponseFlowSection from './response-flow/ResponseFlowSection';
import FallbackToggle from './response-flow/FallbackToggle';
import StyleFields from './response-flow/StyleFields';
import StylePreview from './response-flow/StylePreview';
import LanguageSection from './sections/LanguageSection';
import { useResponseFlow } from './response-flow/useResponseFlow';
import PromptPreviewPanel from './PromptPreviewPanel';

interface Props {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
  agentId?: string;
}

export default function AIAgentSections({ profileData, onSave, agentId }: Props) {
  // Company knowledge bases
  const { knowledgeBases } = useCompanyKB();
  const { debugMode } = useDebugMode();

  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, onSave]
  );

  // Response flow (shared between Response Flow and Fallback Behavior tabs)
  const {
    flow, dirty, updateDefaultStyle,
    addScenario, updateScenario, removeScenario,
    setFallbackMode, setFallbackStyle, reset, clearDirty,
  } = useResponseFlow(profileData);

  useFormDirtyGuard(dirty);

  const [saving, setSaving] = useState(false);

  const handleSaveFlow = useCallback(async () => {
    setSaving(true);
    try {
      const merged = { ...profileData, response_flow: flow };
      await onSave({ profile_data: merged });
      clearDirty();
      toast.success('Saved');
    } finally {
      setSaving(false);
    }
  }, [profileData, flow, onSave, clearDirty]);

  const saveFooter = dirty ? (
    <div className="flex items-center justify-end border-t pt-4 gap-2">
      <Button variant="outline" size="sm" onClick={reset}>
        Cancel
      </Button>
      <PlanGate>
        <Button size="sm" onClick={handleSaveFlow} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </PlanGate>
    </div>
  ) : null;

  // Language preference
  const [langExpanded, setLangExpanded] = useState(false);

  return (
    <Tabs defaultValue="response-flow">
      <TabsList className="w-full">
        <TabsTrigger value="response-flow" className="flex-1">Response Flow</TabsTrigger>
        <TabsTrigger value="style" className="flex-1">Communication Style</TabsTrigger>
        <TabsTrigger value="language" className="flex-1">Language Preferences</TabsTrigger>
        <TabsTrigger value="fallback" className="flex-1">Fallback Behavior</TabsTrigger>
      </TabsList>

      <TabsContent value="response-flow" className="space-y-5 pt-1">
        <p className="text-xs text-muted-foreground">
          Your AI agent responds to messages using your knowledge base and instructions. It can share information, answer questions, and direct customers to the right resources.
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

      <TabsContent value="style" className="space-y-5 pt-3">
        <p className="text-xs text-muted-foreground">
          Set the tone and style for your AI agent. Scenarios and fallback behavior can override these individually.
        </p>
        <StyleFields style={flow.default_style} onChange={updateDefaultStyle} />
        <StylePreview style={flow.default_style} />
        {saveFooter}
      </TabsContent>

      <TabsContent value="language" className="space-y-5 pt-1">
        <LanguageSection
          profileData={profileData}
          isExpanded={langExpanded}
          onToggle={() => setLangExpanded((prev) => !prev)}
          onSave={saveProfileFields}
        />
      </TabsContent>

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
        {saveFooter}
      </TabsContent>
    </Tabs>
  );
}
