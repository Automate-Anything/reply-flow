import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, X, Wand2, Zap, Settings } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  useClassificationSuggestions,
  type ClassificationSuggestion,
  type SuggestionItem,
  type PartialAccept,
} from '@/hooks/useClassificationSuggestions';

interface ClassificationTabProps {
  sessionId: string | null;
}

interface ClassificationStatus {
  enabled: boolean;
  channel_id: number | null;
  mode: string;
  override: string;
}

// ── Pending Suggestion Card ──────────────────────────────────

function PendingSuggestionCard({
  suggestion,
  onAccept,
  onAcceptPartial,
  onDismiss,
}: {
  suggestion: ClassificationSuggestion;
  onAccept: (id: string) => Promise<void>;
  onAcceptPartial: (id: string, partial: PartialAccept) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const s = suggestion.suggestions;
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Track which items are checked (all checked by default)
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(
    new Set((s.labels ?? []).map((l) => l.id))
  );
  const [checkedPriority, setCheckedPriority] = useState(!!s.priority);
  const [checkedStatus, setCheckedStatus] = useState(!!s.status);
  const [checkedTags, setCheckedTags] = useState<Set<string>>(
    new Set((s.contact_tags ?? []).map((t) => t.id))
  );
  const [checkedLists, setCheckedLists] = useState<Set<string>>(
    new Set((s.contact_lists ?? []).map((l) => l.id))
  );

  const allChecked =
    checkedLabels.size === (s.labels ?? []).length &&
    checkedPriority === !!s.priority &&
    checkedStatus === !!s.status &&
    checkedTags.size === (s.contact_tags ?? []).length &&
    checkedLists.size === (s.contact_lists ?? []).length;

  const noneChecked =
    checkedLabels.size === 0 &&
    !checkedPriority &&
    !checkedStatus &&
    checkedTags.size === 0 &&
    checkedLists.size === 0;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      if (allChecked) {
        await onAccept(suggestion.id);
      } else {
        const partial: PartialAccept = {
          labels: Array.from(checkedLabels),
          priority: checkedPriority,
          status: checkedStatus,
          contact_tags: Array.from(checkedTags),
          contact_lists: Array.from(checkedLists),
        };
        await onAcceptPartial(suggestion.id, partial);
      }
      toast.success('Classification applied');
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
      toast.success('Suggestions dismissed');
    } catch {
      toast.error('Failed to dismiss');
    } finally {
      setDismissing(false);
    }
  };

  const toggleInSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const renderItems = (label: string, items: SuggestionItem[] | undefined, checked: Set<string>, setter: (s: Set<string>) => void) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={checked.has(item.id)}
              onCheckedChange={() => toggleInSet(checked, item.id, setter)}
            />
            <span>{item.name || item.id}</span>
            <Badge variant="secondary" className="text-[10px] ml-auto" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
              {Math.round(item.confidence * 100)}%
            </Badge>
          </label>
        ))}
      </div>
    );
  };

  const renderSingle = (label: string, item: SuggestionItem | undefined, checked: boolean, setter: (v: boolean) => void) => {
    if (!item) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={checked} onCheckedChange={() => setter(!checked)} />
          <span>{item.name || item.id}</span>
          <Badge variant="secondary" className="text-[10px] ml-auto" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
            {Math.round(item.confidence * 100)}%
          </Badge>
        </label>
      </div>
    );
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
        {renderItems('Labels', s.labels, checkedLabels, setCheckedLabels)}
        {renderSingle('Priority', s.priority, checkedPriority, setCheckedPriority)}
        {renderSingle('Status', s.status, checkedStatus, setCheckedStatus)}
        {renderItems('Contact Tags', s.contact_tags, checkedTags, setCheckedTags)}
        {renderItems('Contact Lists', s.contact_lists, checkedLists, setCheckedLists)}

        {s.reasoning && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Reasoning
            </button>
            {expanded && <p className="mt-1 text-xs text-muted-foreground">{s.reasoning}</p>}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleAccept} disabled={accepting || dismissing || noneChecked}>
            {accepting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            {allChecked ? 'Accept All' : 'Accept Selected'}
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

// ── History Entry ────────────────────────────────────────────

function HistoryEntry({ suggestion }: { suggestion: ClassificationSuggestion }) {
  const s = suggestion.suggestions;
  const categories = Object.keys(s).filter((k) => k !== 'reasoning');

  return (
    <div className="flex items-start gap-2 py-2 border-b last:border-0">
      <span className="mt-0.5 text-muted-foreground">
        {suggestion.trigger === 'auto' ? <Zap className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium capitalize">{suggestion.status}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(suggestion.created_at).toLocaleDateString()} {new Date(suggestion.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {categories.join(', ')}
        </p>
      </div>
    </div>
  );
}

// ── Main ClassificationTab ───────────────────────────────────

export default function ClassificationTab({ sessionId }: ClassificationTabProps) {
  const { suggestions, loading, classifying, classify, accept, dismiss, acceptPartial } =
    useClassificationSuggestions(sessionId);

  const [status, setStatus] = useState<ClassificationStatus | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/classification/status/${sessionId}`)
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus(null));
  }, [sessionId]);

  if (!sessionId) return null;

  // Disabled state
  if (status && !status.enabled) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground space-y-2">
        <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/50" />
        <p>Classification is not enabled.</p>
        <Button variant="link" size="sm" asChild>
          <a href="/settings/conversations">Enable in settings</a>
        </Button>
      </div>
    );
  }

  const pending = suggestions.filter((s) => s.status === 'pending');
  const history = suggestions.filter((s) => s.status !== 'pending');
  const visibleHistory = showAllHistory ? history : history.slice(0, 3);

  return (
    <div className="p-4 space-y-4">
      {/* Analyze button */}
      <Button
        className="w-full"
        variant={pending.length > 0 ? 'outline' : 'default'}
        onClick={() => classify().catch(() => toast.error('Classification failed'))}
        disabled={classifying || loading}
      >
        {classifying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        {classifying ? 'Analyzing...' : 'Analyze Conversation'}
      </Button>

      {/* Pending suggestions */}
      {pending.map((s) => (
        <PendingSuggestionCard
          key={s.id}
          suggestion={s}
          onAccept={accept}
          onAcceptPartial={acceptPartial}
          onDismiss={dismiss}
        />
      ))}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">History</h4>
          {visibleHistory.map((s) => (
            <HistoryEntry key={s.id} suggestion={s} />
          ))}
          {history.length > 3 && !showAllHistory && (
            <button
              onClick={() => setShowAllHistory(true)}
              className="text-xs text-primary hover:underline mt-1"
            >
              Show all ({history.length})
            </button>
          )}
        </div>
      )}

      {/* Settings links */}
      <div className="pt-2 border-t space-y-1">
        <a href="/settings/conversations" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings className="h-3 w-3" /> Company classification settings
        </a>
        {status?.channel_id && (
          <a href={`/settings/channels/${status.channel_id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Settings className="h-3 w-3" /> Channel classification settings
          </a>
        )}
      </div>
    </div>
  );
}
