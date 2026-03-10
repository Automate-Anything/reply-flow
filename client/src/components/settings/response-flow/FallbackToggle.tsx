import { Label } from '@/components/ui/label';
import type { FallbackMode, CommunicationStyle, ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import type { KnowledgeBase } from '@/hooks/useCompanyKB';
import StyleFields from './StyleFields';
import KBPicker from '../KBPicker';

interface Props {
  mode: FallbackMode;
  onChange: (mode: FallbackMode) => void;
  style: CommunicationStyle;
  greetingMessage?: string;
  responseRules?: string;
  topicsToAvoid?: string;
  knowledgeBases?: KnowledgeBase[];
  fallbackKBAttachments?: ScenarioKBAttachment[];
  onStyleChange: (style: CommunicationStyle) => void;
  onGreetingChange: (value: string) => void;
  onRulesChange: (value: string) => void;
  onTopicsChange: (value: string) => void;
  onFallbackKBChange?: (attachments: ScenarioKBAttachment[]) => void;
}

export default function FallbackToggle({
  mode, onChange,
  style, greetingMessage, responseRules, topicsToAvoid,
  knowledgeBases = [], fallbackKBAttachments = [],
  onStyleChange, onGreetingChange, onRulesChange, onTopicsChange,
  onFallbackKBChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2">
        {/* Option 1: AI responds */}
        <div className={`rounded-lg border overflow-hidden transition-colors ${
          mode === 'respond_basics'
            ? 'border-primary'
            : 'border-border hover:border-muted-foreground/30'
        }`}>
          <button
            type="button"
            onClick={() => onChange('respond_basics')}
            className={`flex w-full items-center gap-3 p-3 text-left cursor-pointer transition-colors ${
              mode === 'respond_basics' ? 'bg-primary/5' : ''
            }`}
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
              mode === 'respond_basics' ? 'border-primary' : 'border-muted-foreground/40'
            }`}>
              {mode === 'respond_basics' && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <div>
              <p className="text-xs font-medium">AI responds using fallback style</p>
              <p className="text-xs text-muted-foreground">
                Uses the communication style below and knowledge base to handle messages that don't match a scenario.
              </p>
            </div>
          </button>

          {mode === 'respond_basics' && (
            <div className="border-t border-primary/20 bg-muted/30 p-4 space-y-4">
              <StyleFields style={style} onChange={onStyleChange} compact />

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Greeting Message (optional)</Label>
                <textarea
                  value={greetingMessage || ''}
                  onChange={(e) => onGreetingChange(e.target.value)}
                  rows={2}
                  placeholder="e.g. Hi! Welcome to Acme Corp. How can I help you today?"
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Sent as the first response to new contacts.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">General Response Rules (optional)</Label>
                <textarea
                  value={responseRules || ''}
                  onChange={(e) => onRulesChange(e.target.value)}
                  rows={3}
                  placeholder="e.g. Always mention our business hours (9am-5pm). Never discuss competitor products."
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Topics to Avoid (optional)</Label>
                <textarea
                  value={topicsToAvoid || ''}
                  onChange={(e) => onTopicsChange(e.target.value)}
                  rows={2}
                  placeholder="e.g. Internal pricing strategies, competitor comparisons..."
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {onFallbackKBChange && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Knowledge Base</Label>
                  <KBPicker
                    value={fallbackKBAttachments}
                    onChange={onFallbackKBChange}
                    knowledgeBases={knowledgeBases}
                    description="Attach knowledge bases the AI should reference when handling fallback messages."
                    createHref="/knowledge-base"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Option 2: Human handle */}
        <div className={`rounded-lg border overflow-hidden transition-colors ${
          mode === 'human_handle'
            ? 'border-primary'
            : 'border-border hover:border-muted-foreground/30'
        }`}>
          <button
            type="button"
            onClick={() => onChange('human_handle')}
            className={`flex w-full items-center gap-3 p-3 text-left cursor-pointer transition-colors ${
              mode === 'human_handle' ? 'bg-primary/5' : ''
            }`}
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
              mode === 'human_handle' ? 'border-primary' : 'border-muted-foreground/40'
            }`}>
              {mode === 'human_handle' && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <div>
              <p className="text-xs font-medium">Let a human handle it</p>
              <p className="text-xs text-muted-foreground">
                The AI won't respond. A team member can reply manually.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
