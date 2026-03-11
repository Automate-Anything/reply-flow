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
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Scenario, CommunicationStyle, ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import type { KnowledgeBase } from '@/hooks/useCompanyKB';
import { Switch } from '@/components/ui/switch';
import StyleFields from './StyleFields';
import { getPlaceholders } from './scenarioPlaceholders';
import KBPicker from '../KBPicker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: Scenario | null;
  defaultStyle: CommunicationStyle;
  knowledgeBases?: KnowledgeBase[];
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

export default function ScenarioDialog({ open, onOpenChange, scenario, defaultStyle, knowledgeBases = [], onSave }: Props) {
  const [label, setLabel] = useState('');
  const [criteria, setCriteria] = useState('');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [kbAttachments, setKbAttachments] = useState<ScenarioKBAttachment[]>([]);
  const [rules, setRules] = useState('');
  const [exampleResponse, setExampleResponse] = useState('');
  const [escalationTrigger, setEscalationTrigger] = useState('');
  const [doNotRespond, setDoNotRespond] = useState(false);
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
        setKbAttachments(scenario.kb_attachments ?? []);
        setRules(scenario.rules || '');
        setExampleResponse(scenario.example_response || '');
        setEscalationTrigger(scenario.escalation_trigger || '');
        setDoNotRespond(!!scenario.do_not_respond);
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
        setKbAttachments([]);
        setRules('');
        setExampleResponse('');
        setEscalationTrigger('');
        setDoNotRespond(false);
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
      do_not_respond: doNotRespond || undefined,
      goal: goal.trim() || undefined,
      instructions: instructions.trim() || undefined,
      kb_attachments: kbAttachments.length > 0 ? kbAttachments : undefined,
      rules: rules.trim() || undefined,
      example_response: exampleResponse.trim() || undefined,
      escalation_trigger: escalationTrigger.trim() || undefined,
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
      <DialogContent className="sm:max-w-[960px] max-h-[85vh] overflow-y-auto sm:left-[58.5%]">
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
            <div className="flex items-center gap-1">
              <Label className="text-xs">Trigger Condition *</Label>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    The AI reads each incoming message and uses this description to decide if it matches this scenario. Be specific about keywords, intents, or message patterns.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              Describe the types of messages the AI should classify under this scenario.
            </p>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={3}
              placeholder={ph.detection_criteria}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* ── How to Respond ── */}
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-3">
            <div className="space-y-1">
              <Label className="text-xs">Do not respond automatically</Label>
              <p className="text-xs text-muted-foreground">
                When this scenario matches, the AI will stay silent and switch the conversation into human takeover.
              </p>
            </div>
            <Switch checked={doNotRespond} onCheckedChange={setDoNotRespond} />
          </div>

          {!doNotRespond && (
            <>
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

          {/* ── Communication Style ── */}
          <SectionHeader label="Communication Style" />
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-3">
            <div className="space-y-1">
              <Label className="text-xs">Override default communication style</Label>
              <p className="text-xs text-muted-foreground">
                Turn this on to customize tone, response length, and emoji usage for this scenario only.
              </p>
            </div>
            <Switch checked={showStyle} onCheckedChange={setShowStyle} />
          </div>
          {showStyle ? (
            <div>
              <StyleFields style={style} onChange={setStyle} compact />
            </div>
          ) : (
            <p className="text-center text-[10px] text-muted-foreground">
              Using the default communication style for this scenario.
            </p>
          )}

          {/* ── Knowledge Base ── */}
          <div className="space-y-2">
            <Label className="text-xs">Knowledge Base</Label>
            <KBPicker
              value={kbAttachments}
              onChange={setKbAttachments}
              knowledgeBases={knowledgeBases}
              description="Attach knowledge bases the AI should reference for this scenario."
              createHref="/knowledge-base"
            />
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

          {/* ── Human Takeover ── */}
          <SectionHeader label="Human Takeover" />
          <div className="space-y-1.5">
            <Label className="text-xs">Pause Condition</Label>
            <textarea
              value={escalationTrigger}
              onChange={(e) => setEscalationTrigger(e.target.value)}
              rows={2}
              placeholder={ph.escalation_trigger}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              When these conditions are met, the AI will stop responding and wait for a team member to reply.
            </p>
          </div>
            </>
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
