import { useState } from 'react';
import { BookOpen } from 'lucide-react';
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
          <div className="space-y-2">
            <Label className="text-xs font-medium">When to use this knowledge</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraftMode('always')}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  draftMode === 'always'
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <span className="block text-xs font-medium">Always</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Included in every message, even when a scenario matches
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDraftMode('fallback')}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  draftMode === 'fallback'
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <span className="block text-xs font-medium">Fallback only</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Used only when no scenario matches
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
