import { useState, useRef, useEffect } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import type { ProfileData } from '@/hooks/useCompanyAI';

interface PromptSection {
  name: string;
  content: string;
}

interface PromptPreviewData {
  sections: PromptSection[];
  systemPrompt: string;
  kbEntryCount: number;
}

interface Props {
  profileData: ProfileData;
  agentId?: string;
  matchedScenario?: string | null;
}

// ── Section color maps ────────────────────────────

const sectionColors = [
  'bg-purple-200/40 dark:bg-purple-900/30',
  'bg-blue-200/40 dark:bg-blue-900/30',
  'bg-green-200/40 dark:bg-green-900/30',
  'bg-amber-200/40 dark:bg-amber-900/30',
  'bg-pink-200/40 dark:bg-pink-900/30',
  'bg-cyan-200/40 dark:bg-cyan-900/30',
  'bg-orange-200/40 dark:bg-orange-900/30',
  'bg-indigo-200/40 dark:bg-indigo-900/30',
  'bg-rose-200/40 dark:bg-rose-900/30',
  'bg-teal-200/40 dark:bg-teal-900/30',
  'bg-violet-200/40 dark:bg-violet-900/30',
  'bg-lime-200/40 dark:bg-lime-900/30',
];

const sectionDots = [
  'bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-amber-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-orange-500', 'bg-indigo-500',
  'bg-rose-500', 'bg-teal-500', 'bg-violet-500', 'bg-lime-500',
];

// ── Prompt Builder View (reusable) ─────────────────

export function PromptBuilderView({ sections, fullPrompt }: { sections: PromptSection[]; fullPrompt: string }) {
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (activeSection === null || !promptRef.current) return;
    const section = sections[activeSection];
    if (!section) return;

    const idx = fullPrompt.indexOf(section.content);
    if (idx === -1) return;

    const el = promptRef.current;
    const totalChars = fullPrompt.length;
    const scrollRatio = idx / totalChars;
    el.scrollTop = scrollRatio * el.scrollHeight;
  }, [activeSection, sections, fullPrompt]);

  const buildHighlightedPrompt = () => {
    const segments: Array<{ text: string; sectionIndex: number | null }> = [];
    let pos = 0;

    const sectionPositions = sections.map((s, i) => {
      const idx = fullPrompt.indexOf(s.content);
      return { index: i, start: idx, end: idx >= 0 ? idx + s.content.length : -1 };
    }).filter(s => s.start >= 0).sort((a, b) => a.start - b.start);

    for (const sp of sectionPositions) {
      if (sp.start > pos) {
        segments.push({ text: fullPrompt.slice(pos, sp.start), sectionIndex: null });
      }
      segments.push({ text: fullPrompt.slice(sp.start, sp.end), sectionIndex: sp.index });
      pos = sp.end;
    }

    if (pos < fullPrompt.length) {
      segments.push({ text: fullPrompt.slice(pos), sectionIndex: null });
    }

    return segments.length > 0 ? segments : [{ text: fullPrompt, sectionIndex: null }];
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(fullPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const segments = buildHighlightedPrompt();

  return (
    <div className="flex gap-2 min-h-[200px] max-h-[500px]">
      {/* Left: Section list */}
      <div className="w-[200px] shrink-0 overflow-y-auto space-y-1 pr-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Sections ({sections.length})
        </p>
        {sections.map((section, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveSection(activeSection === i ? null : i)}
            className={cn(
              'w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-center gap-1.5',
              activeSection === i
                ? 'bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200 font-medium'
                : 'hover:bg-muted/50 text-muted-foreground'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full shrink-0', sectionDots[i % sectionDots.length])} />
            <span className="truncate">{section.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
              {section.content.length}
            </span>
          </button>
        ))}
        {/* Section content preview when selected */}
        {activeSection !== null && sections[activeSection] && (
          <div className="mt-2 rounded border bg-muted/30 p-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">
              {sections[activeSection].name}
            </p>
            <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {sections[activeSection].content}
            </pre>
          </div>
        )}
      </div>

      {/* Right: Full assembled prompt with highlights */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Full Prompt ({fullPrompt.length.toLocaleString()} chars)
          </p>
          <button
            onClick={handleCopyPrompt}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre
          ref={promptRef}
          className="flex-1 rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words overflow-y-auto"
        >
          {segments.map((seg, i) => (
            <span
              key={i}
              className={cn(
                seg.sectionIndex !== null && sectionColors[seg.sectionIndex % sectionColors.length],
                seg.sectionIndex !== null && activeSection === seg.sectionIndex && 'ring-1 ring-purple-400 rounded',
              )}
            >
              {seg.text}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}

// ── Main Preview Panel (for AI Agents page) ──────

export default function PromptPreviewPanel({ profileData, agentId, matchedScenario }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PromptPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(matchedScenario ?? null);

  const scenarios = profileData.response_flow?.scenarios ?? [];

  const loadPreview = async (scenarioLabel?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const { data: result } = await api.post('/ai/preview-prompt', {
        profile_data: agentId ? undefined : profileData,
        agentId,
        matched_scenario: scenarioLabel,
      });
      setData(result);
    } catch {
      setError('Failed to load prompt preview');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !data) {
      loadPreview(selectedScenario);
    }
  };

  const handleScenarioChange = (label: string | null) => {
    setSelectedScenario(label);
    loadPreview(label);
  };

  return (
    <div className="rounded-lg border border-dashed border-purple-300/50 bg-purple-500/5">
      {/* Header toggle */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-purple-500/10 transition-colors"
        onClick={handleToggle}
      >
        {expanded ? (
          <EyeOff className="h-4 w-4 text-purple-500" />
        ) : (
          <Eye className="h-4 w-4 text-purple-500" />
        )}
        <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
          Prompt Preview
        </span>
        <span className="text-xs text-purple-500/70">
          See the assembled system prompt
        </span>
        {expanded ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-purple-400" />
        ) : (
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-purple-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-purple-300/30 px-4 py-3 space-y-3">
          {/* Scenario selector (if scenarios exist) */}
          {scenarios.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Build prompt for:</span>
              <button
                type="button"
                onClick={() => handleScenarioChange(null)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  selectedScenario === null
                    ? 'bg-purple-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                Default (no scenario)
              </button>
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleScenarioChange(s.label)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    selectedScenario === s.label
                      ? 'bg-purple-500 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Refresh button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadPreview(selectedScenario)}
              disabled={loading}
              className="h-7 text-xs gap-1.5"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Refresh Preview
            </Button>
            {data && (
              <span className="text-[10px] text-muted-foreground">
                {data.sections.length} sections, {data.systemPrompt.length.toLocaleString()} chars total, {data.kbEntryCount} KB entries
              </span>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {loading && !data && (
            <div className="flex items-center gap-2 py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
              <span className="text-sm text-muted-foreground">Building prompt...</span>
            </div>
          )}

          {data && (
            <PromptBuilderView sections={data.sections} fullPrompt={data.systemPrompt} />
          )}
        </div>
      )}
    </div>
  );
}
