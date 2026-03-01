import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, X, AlertTriangle } from 'lucide-react';
import type { Scenario, CommunicationStyle } from '@/hooks/useCompanyAI';

interface Props {
  scenario: Scenario;
  defaultStyle: CommunicationStyle;
  onEdit: () => void;
  onDelete: () => void;
}

export default function ScenarioCard({ scenario, defaultStyle, onEdit, onDelete }: Props) {
  // Build badges for style overrides (only show if different from default)
  const overrides: string[] = [];
  if (scenario.tone && scenario.tone !== defaultStyle.tone) {
    overrides.push(scenario.tone.charAt(0).toUpperCase() + scenario.tone.slice(1));
  }
  if (scenario.response_length && scenario.response_length !== defaultStyle.response_length) {
    overrides.push(scenario.response_length);
  }
  if (scenario.emoji_usage && scenario.emoji_usage !== defaultStyle.emoji_usage) {
    overrides.push(`emoji: ${scenario.emoji_usage}`);
  }

  const hasEscalation = !!(scenario.escalation_trigger?.trim() || scenario.escalation_rules?.trim());

  return (
    <div className="group rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{scenario.label}</p>
          {scenario.goal ? (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
              {scenario.goal}
            </p>
          ) : scenario.detection_criteria && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
              {scenario.detection_criteria}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {overrides.map((o) => (
              <Badge key={o} variant="outline" className="text-[10px] font-normal">
                {o}
              </Badge>
            ))}
            {scenario.instructions && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Instructions
              </Badge>
            )}
            {scenario.context && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Context
              </Badge>
            )}
            {scenario.rules && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Rules
              </Badge>
            )}
            {scenario.example_response && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Example
              </Badge>
            )}
            {hasEscalation && (
              <Badge variant="outline" className="text-[10px] font-normal text-amber-600 border-amber-300">
                <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                Escalation
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
            onClick={onDelete}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
