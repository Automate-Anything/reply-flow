import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FallbackMode, CommunicationStyle } from '@/hooks/useCompanyAI';
import { OptionButton } from './StyleFields';
import StyleFields from './StyleFields';
import { MessageCircle, UserCheck, Phone } from 'lucide-react';

interface Props {
  mode: FallbackMode;
  onChange: (mode: FallbackMode) => void;
  style: CommunicationStyle;
  greetingMessage?: string;
  responseRules?: string;
  topicsToAvoid?: string;
  humanPhone?: string;
  onStyleChange: (style: CommunicationStyle) => void;
  onGreetingChange: (value: string) => void;
  onRulesChange: (value: string) => void;
  onTopicsChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
}

export default function FallbackToggle({
  mode, onChange,
  style, greetingMessage, responseRules, topicsToAvoid, humanPhone,
  onStyleChange, onGreetingChange, onRulesChange, onTopicsChange, onPhoneChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs font-medium">Unmatched Messages</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What should happen when a message doesn't match any scenario?
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <OptionButton
          selected={mode === 'respond_basics'}
          onClick={() => onChange('respond_basics')}
        >
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">AI responds with default style</p>
            <p className="text-xs text-muted-foreground">
              Uses the communication style below along with your knowledge base.
            </p>
          </div>
        </OptionButton>
        <OptionButton
          selected={mode === 'human_handle'}
          onClick={() => onChange('human_handle')}
        >
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">Let a human handle it</p>
            <p className="text-xs text-muted-foreground">
              AI directs the customer to a team member.
            </p>
          </div>
        </OptionButton>
      </div>

      {/* Default style settings — shown when AI responds */}
      {mode === 'respond_basics' && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-5">
          <StyleFields style={style} onChange={onStyleChange} compact />

          <div className="space-y-1.5">
            <Label className="text-xs">Greeting Message (optional)</Label>
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
            <Label className="text-xs">General Response Rules (optional)</Label>
            <textarea
              value={responseRules || ''}
              onChange={(e) => onRulesChange(e.target.value)}
              rows={3}
              placeholder="e.g. Always mention our business hours (9am-5pm). Never discuss competitor products."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Topics to Avoid (optional)</Label>
            <textarea
              value={topicsToAvoid || ''}
              onChange={(e) => onTopicsChange(e.target.value)}
              rows={2}
              placeholder="e.g. Internal pricing strategies, competitor comparisons..."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* Human handoff settings */}
      {mode === 'human_handle' && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs">Handoff Phone Number</Label>
          </div>
          <Input
            value={humanPhone || ''}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="e.g. +1 (555) 123-4567"
            className="h-9"
          />
          <p className="text-xs text-muted-foreground">
            The AI will direct customers to contact this number for help.
          </p>
        </div>
      )}
    </div>
  );
}
