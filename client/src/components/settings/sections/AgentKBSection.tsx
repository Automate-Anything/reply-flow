import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import type { KnowledgeBase } from '@/hooks/useCompanyKB';
import KBPicker from '../KBPicker';
import SectionCard from './SectionCard';

interface Props {
  kbAttachments: ScenarioKBAttachment[];
  agentKBMode: 'always' | 'fallback';
  knowledgeBases: KnowledgeBase[];
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (kbAttachments: ScenarioKBAttachment[], mode: 'always' | 'fallback') => Promise<void>;
}

function formatKBSummary(count: number, mode: 'always' | 'fallback'): string {
  if (count === 0) return 'No knowledge bases attached';
  const modeLabel = mode === 'always' ? 'always included' : 'fallback only';
  return `${count} knowledge base${count !== 1 ? 's' : ''} attached (${modeLabel})`;
}

export default function AgentKBSection({
  kbAttachments,
  agentKBMode,
  knowledgeBases,
  isExpanded,
  onToggle,
  onSave,
}: Props) {
  const [draftAttachments, setDraftAttachments] = useState<ScenarioKBAttachment[]>(kbAttachments);
  const [draftMode, setDraftMode] = useState<'always' | 'fallback'>(agentKBMode);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draftAttachments, draftMode);
      onToggle();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftAttachments(kbAttachments);
    setDraftMode(agentKBMode);
    onToggle();
  };

  const isConfigured = kbAttachments.length > 0;

  return (
    <SectionCard
      icon={<BookOpen className="h-4 w-4" />}
      title="Knowledge Base"
      isConfigured={isConfigured}
      summary={formatKBSummary(kbAttachments.length, agentKBMode)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Attach knowledge bases for your AI agent to reference across conversations.
        </p>

        <KBPicker
          value={draftAttachments}
          onChange={setDraftAttachments}
          knowledgeBases={knowledgeBases}
          createHref="/knowledge-base"
        />

        {draftAttachments.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="agent-kb-mode" className="text-xs font-medium">
                Include in all messages
              </Label>
              <p className="text-xs text-muted-foreground">
                {draftMode === 'always'
                  ? 'Knowledge base will be included alongside scenario-specific knowledge in every response'
                  : 'Knowledge base will only be used when no scenario matches'}
              </p>
            </div>
            <Switch
              id="agent-kb-mode"
              checked={draftMode === 'always'}
              onCheckedChange={(checked) => setDraftMode(checked ? 'always' : 'fallback')}
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
