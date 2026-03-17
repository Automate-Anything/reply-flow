import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, X, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useClassificationSuggestions,
  type ClassificationSuggestion,
  type SuggestionItem,
} from '@/hooks/useClassificationSuggestions';

interface ClassificationCardProps {
  sessionId: string | null;
  onUpdate?: () => void;
}

function SuggestionItemBadge({ item }: { item: SuggestionItem }) {
  return (
    <Badge variant="secondary" className="text-xs" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
      {item.name || item.id}
      <span className="ml-1 text-muted-foreground">{Math.round(item.confidence * 100)}%</span>
    </Badge>
  );
}

function SuggestionRow({ label, items }: { label: string; items?: SuggestionItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <SuggestionItemBadge key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function PendingSuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  onUpdate,
}: {
  suggestion: ClassificationSuggestion;
  onAccept: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onUpdate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const s = suggestion.suggestions;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept(suggestion.id);
      toast.success('Classification applied');
      onUpdate?.();
    } catch {
      toast.error('Failed to apply classification');
    } finally {
      setAccepting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(suggestion.id);
    } catch {
      toast.error('Failed to dismiss');
    } finally {
      setDismissing(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <SuggestionRow label="Labels" items={s.labels} />
        {s.priority && <SuggestionRow label="Priority" items={[s.priority]} />}
        {s.status && <SuggestionRow label="Status" items={[s.status]} />}
        <SuggestionRow label="Contact Tags" items={s.contact_tags} />
        <SuggestionRow label="Contact Lists" items={s.contact_lists} />

        {s.reasoning && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Reasoning
            </button>
            {expanded && (
              <p className="mt-1 text-xs text-muted-foreground">{s.reasoning}</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleAccept} disabled={accepting || dismissing}>
            {accepting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Accept All
          </Button>
          <Button size="sm" variant="outline" onClick={handleDismiss} disabled={accepting || dismissing}>
            {dismissing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClassificationCard({ sessionId, onUpdate }: ClassificationCardProps) {
  const { suggestions, loading, classifying, classify, accept, dismiss } = useClassificationSuggestions(sessionId);

  const pending = suggestions.filter((s) => s.status === 'pending');
  const applied = suggestions.filter((s) => s.status === 'accepted' || s.status === 'applied');

  if (loading) return null;

  return (
    <div className="space-y-3">
      {/* Analyze button when no pending suggestions */}
      {pending.length === 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            classify().catch(() => toast.error('Classification failed'));
          }}
          disabled={classifying}
        >
          {classifying ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          {classifying ? 'Analyzing...' : 'Analyze Conversation'}
        </Button>
      )}

      {/* Pending suggestions */}
      {pending.map((s) => (
        <PendingSuggestionCard
          key={s.id}
          suggestion={s}
          onAccept={accept}
          onDismiss={dismiss}
          onUpdate={onUpdate}
        />
      ))}

      {/* Applied summary (most recent only) */}
      {pending.length === 0 && applied.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline h-3 w-3" />
          AI classified this conversation {new Date(applied[0].applied_at || applied[0].created_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
