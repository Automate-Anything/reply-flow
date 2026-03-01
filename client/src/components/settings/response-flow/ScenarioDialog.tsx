import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ChevronDown } from 'lucide-react';
import type { Scenario, CommunicationStyle } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
import StyleFields from './StyleFields';
import { getPlaceholders } from './scenarioPlaceholders';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: Scenario | null;
  defaultStyle: CommunicationStyle;
  onSave: (data: Omit<Scenario, 'id'>) => void;
}

function SectionHeader({ label, onClick, expandIcon }: {
  label: string;
  onClick?: () => void;
  expandIcon?: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className="flex w-full items-center gap-2 pt-2"
      onClick={onClick}
    >
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {expandIcon}
      <div className="h-px flex-1 bg-border" />
    </Tag>
  );
}

export default function ScenarioDialog({ open, onOpenChange, scenario, defaultStyle, onSave }: Props) {
  const [label, setLabel] = useState('');
  const [criteria, setCriteria] = useState('');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [context, setContext] = useState('');
  const [rules, setRules] = useState('');
  const [exampleResponse, setExampleResponse] = useState('');
  const [escalationTrigger, setEscalationTrigger] = useState('');
  const [escalationMessage, setEscalationMessage] = useState('');
  const [style, setStyle] = useState<CommunicationStyle>({});
  const [showStyle, setShowStyle] = useState(false);

  const ph = useMemo(() => getPlaceholders(label), [label]);

  useEffect(() => {
    if (open) {
      if (scenario) {
        setLabel(scenario.label);
        setCriteria(scenario.detection_criteria);
        setGoal(scenario.goal || '');
        setInstructions(scenario.instructions || '');
        setContext(scenario.context || '');
        setRules(scenario.rules || '');
        setExampleResponse(scenario.example_response || '');
        setEscalationTrigger(scenario.escalation_trigger || '');
        setEscalationMessage(scenario.escalation_message || '');
        setStyle({
          tone: scenario.tone ?? defaultStyle.tone,
          response_length: scenario.response_length ?? defaultStyle.response_length,
          emoji_usage: scenario.emoji_usage ?? defaultStyle.emoji_usage,
        });
        setShowStyle(
          !!(scenario.tone || scenario.response_length || scenario.emoji_usage)
        );
      } else {
        setLabel('');
        setCriteria('');
        setGoal('');
        setInstructions('');
        setContext('');
        setRules('');
        setExampleResponse('');
        setEscalationTrigger('');
        setEscalationMessage('');
        setStyle({ ...defaultStyle });
        setShowStyle(false);
      }
    }
  }, [open, scenario, defaultStyle]);

  const handleSave = () => {
    const tone = style.tone !== defaultStyle.tone ? style.tone : undefined;
    const response_length = style.response_length !== defaultStyle.response_length ? style.response_length : undefined;
    const emoji_usage = style.emoji_usage !== defaultStyle.emoji_usage ? style.emoji_usage : undefined;

    onSave({
      label: label.trim(),
      detection_criteria: criteria.trim(),
      goal: goal.trim() || undefined,
      instructions: instructions.trim() || undefined,
      context: context.trim() || undefined,
      rules: rules.trim() || undefined,
      example_response: exampleResponse.trim() || undefined,
      escalation_trigger: escalationTrigger.trim() || undefined,
      escalation_message: escalationMessage.trim() || undefined,
      tone,
      response_length,
      emoji_usage,
    });
    onOpenChange(false);
  };

  const isValid = label.trim().length > 0 && criteria.trim().length > 0;
  const isEditing = !!scenario;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Scenario' : 'Add Scenario'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Configure how the AI handles this type of message.'
              : 'Define a message type and teach the AI how to handle it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scenario Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Scenario Name *</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Appointment Booking"
              className="h-9"
            />
          </div>

          {/* Detection Criteria */}
          <div className="space-y-1.5">
            <Label className="text-xs">When to Activate *</Label>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={3}
              placeholder={ph.detection_criteria}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Describe the types of messages that should trigger this scenario.
            </p>
          </div>

          {/* ── How to Respond ── */}
          <SectionHeader label="How to Respond" />

          <div className="space-y-1.5">
            <Label className="text-xs">Goal</Label>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={ph.goal}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              What should the AI accomplish in this scenario?
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Step-by-Step Instructions</Label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder={ph.instructions}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              The steps the AI should follow when handling this conversation.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Key Information & Context</Label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder={ph.context}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Business data the AI needs: links, prices, hours, policies, product details.
            </p>
          </div>

          {/* ── Guardrails ── */}
          <SectionHeader label="Guardrails" />

          <div className="space-y-1.5">
            <Label className="text-xs">Rules & Restrictions</Label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={3}
              placeholder={ph.rules}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Things the AI must always or never do in this scenario.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Example Response</Label>
            <textarea
              value={exampleResponse}
              onChange={(e) => setExampleResponse(e.target.value)}
              rows={3}
              placeholder={ph.example_response}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              An ideal response the AI can use as a reference for tone and structure.
            </p>
          </div>

          {/* ── Escalation ── */}
          <SectionHeader label="Escalation" />

          <div className="space-y-1.5">
            <Label className="text-xs">When to Escalate</Label>
            <textarea
              value={escalationTrigger}
              onChange={(e) => setEscalationTrigger(e.target.value)}
              rows={2}
              placeholder={ph.escalation_trigger}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Conditions under which the AI should hand off to a human.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Handoff Message</Label>
            <Input
              value={escalationMessage}
              onChange={(e) => setEscalationMessage(e.target.value)}
              placeholder={ph.escalation_message}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              What the AI says when transferring to a human.
            </p>
          </div>

          {/* ── Communication Style ── */}
          <SectionHeader
            label="Communication Style"
            onClick={() => setShowStyle(!showStyle)}
            expandIcon={
              <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', showStyle && 'rotate-180')} />
            }
          />
          {!showStyle && (
            <p className="text-center text-[10px] text-muted-foreground">
              Uses the default style. Click to override for this scenario.
            </p>
          )}
          {showStyle && (
            <div>
              <StyleFields style={style} onChange={setStyle} compact />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {isEditing ? 'Save Changes' : 'Add Scenario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
