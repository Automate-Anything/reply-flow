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
import IdentitySection from './sections/IdentitySection';
import ResponseFlowSection from './response-flow/ResponseFlowSection';
import FallbackToggle from './response-flow/FallbackToggle';
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

  // Identity
  const [identityExpanded, setIdentityExpanded] = useState(false);

  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
      setIdentityExpanded(false);
    },
    [profileData, onSave]
  );

  // Response flow (shared between Response Flow and Unmatched Messages tabs)
  const {
    flow, dirty, updateFlow, updateDefaultStyle,
    addScenario, updateScenario, removeScenario,
    setFallbackMode, setFallbackKBAttachments, reset, clearDirty,
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

  return (
    <Tabs defaultValue="identity">
      <TabsList className="w-full">
        <TabsTrigger value="identity" className="flex-1">Identity</TabsTrigger>
        <TabsTrigger value="response-flow" className="flex-1">Response Flow</TabsTrigger>
        <TabsTrigger value="unmatched" className="flex-1">Unmatched Messages</TabsTrigger>
      </TabsList>

      <TabsContent value="identity">
        <IdentitySection
          profileData={profileData}
          isExpanded={identityExpanded}
          onToggle={() => setIdentityExpanded((prev) => !prev)}
          onSave={saveProfileFields}
        />
      </TabsContent>

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
        />
        {saveFooter}
        {debugMode && (
          <PromptPreviewPanel profileData={{ ...profileData, response_flow: flow }} agentId={agentId} />
        )}
      </TabsContent>

      <TabsContent value="unmatched" className="space-y-4 pt-1">
        <p className="text-sm text-muted-foreground">
          What should happen when a message doesn't match any scenario?
        </p>
        <FallbackToggle
          mode={flow.fallback_mode}
          onChange={setFallbackMode}
          style={flow.default_style}
          greetingMessage={flow.greeting_message}
          responseRules={flow.response_rules}
          topicsToAvoid={flow.topics_to_avoid}
          humanPhone={flow.human_phone}
          knowledgeBases={knowledgeBases}
          fallbackKBAttachments={flow.fallback_kb_attachments}
          onStyleChange={updateDefaultStyle}
          onGreetingChange={(v) => updateFlow({ greeting_message: v || undefined })}
          onRulesChange={(v) => updateFlow({ response_rules: v || undefined })}
          onTopicsChange={(v) => updateFlow({ topics_to_avoid: v || undefined })}
          onPhoneChange={(v) => updateFlow({ human_phone: v || undefined })}
          onFallbackKBChange={setFallbackKBAttachments}
        />
        {saveFooter}
      </TabsContent>
    </Tabs>
  );
}
