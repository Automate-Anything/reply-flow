import { useState, useRef, useEffect } from 'react';
import {
  Bug,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Search,
  Brain,
  Cpu,
  Clock,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AIDebugData {
  reformulatedQuery: string;
  queryClassification: {
    method: string;
    reasoning: string;
    vectorWeight: number;
    ftsWeight: number;
  } | null;
  kbSearchResults: Array<{
    title: string;
    confidence: string;
    rrfScore: number;
    vectorRank: number;
    ftsRank: number;
    contentPreview: string;
  }>;
  kbFallbackUsed: boolean;
  kbLowConfidence: boolean;
  scenarioLabel: string | null;
  scenarioConfidence: string | null;
  promptSections: Array<{ name: string; content: string }>;
  systemPrompt: string;
  tokens: { input: number; output: number };
  responseTimeMs: number;
  model: string;
  stopReason: string;
}

interface AIDebugPanelProps {
  debugData: AIDebugData;
}

function confidenceBadgeClass(confidence: string): string {
  switch (confidence.toLowerCase()) {
    case 'high':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'low':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function PromptBuilderView({ sections, fullPrompt }: { sections: Array<{ name: string; content: string }>; fullPrompt: string }) {
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement>(null);

  // Find the position of the active section's content in the full prompt and scroll to it
  useEffect(() => {
    if (activeSection === null || !promptRef.current) return;
    const section = sections[activeSection];
    if (!section) return;

    // Find the section content in the full prompt
    const idx = fullPrompt.indexOf(section.content);
    if (idx === -1) return;

    // Calculate approximate scroll position based on character offset
    const el = promptRef.current;
    const totalChars = fullPrompt.length;
    const scrollRatio = idx / totalChars;
    el.scrollTop = scrollRatio * el.scrollHeight;
  }, [activeSection, sections, fullPrompt]);

  // Build section color map for highlighting
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

  // Build highlighted prompt: split full prompt into segments with section markers
  const buildHighlightedPrompt = () => {
    const segments: Array<{ text: string; sectionIndex: number | null }> = [];
    let remaining = fullPrompt;
    let pos = 0;

    // Find each section's position in the full prompt
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
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Sections</p>
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

export default function AIDebugPanel({ debugData }: AIDebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-muted/30 border border-dashed border-purple-300/50 rounded-lg mt-2 p-3 text-xs">
      {/* Collapsed bar */}
      <div
        className="cursor-pointer flex items-center gap-2 text-muted-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <Bug className="size-3.5" />
        <span className="font-medium">Debug</span>
        <span className="text-muted-foreground/70">
          {debugData.tokens.input}
          <ArrowUp className="inline size-3" />
          {' '}
          {debugData.tokens.output}
          <ArrowDown className="inline size-3" />
        </span>
        <span className="text-muted-foreground/70">
          {debugData.responseTimeMs}ms
        </span>
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Query Section */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Search className="size-3.5" />
              Query
            </summary>
            <div className="mt-2 space-y-2 pl-5">
              <div>
                <span className="text-muted-foreground">Reformulated:</span>
                <pre className="mt-1 rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-words">
                  {debugData.reformulatedQuery}
                </pre>
              </div>
              {debugData.queryClassification && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                  >
                    {debugData.queryClassification.method}
                  </span>
                  <span className="text-muted-foreground">
                    Vector: {debugData.queryClassification.vectorWeight} | FTS: {debugData.queryClassification.ftsWeight}
                  </span>
                  <span className="text-muted-foreground/70 italic">
                    {debugData.queryClassification.reasoning}
                  </span>
                </div>
              )}
            </div>
          </details>

          {/* KB Results Section */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Brain className="size-3.5" />
              KB Results
              <span className="text-muted-foreground/70 font-normal">
                ({debugData.kbSearchResults.length})
              </span>
              {debugData.kbFallbackUsed && (
                <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                  fallback
                </span>
              )}
              {debugData.kbLowConfidence && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                  low confidence
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-1.5 pl-5">
              {debugData.kbSearchResults.length === 0 ? (
                <p className="text-muted-foreground italic">No KB results</p>
              ) : (
                debugData.kbSearchResults.map((result, i) => (
                  <details key={i} className="rounded bg-muted/30 p-2">
                    <summary className="cursor-pointer flex items-center gap-2">
                      <span className="font-medium truncate max-w-[200px]">
                        {result.title}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          confidenceBadgeClass(result.confidence)
                        )}
                      >
                        {result.confidence}
                      </span>
                      <span className="text-muted-foreground/70 font-mono">
                        RRF: {result.rrfScore.toFixed(4)}
                      </span>
                      <span className="text-muted-foreground/70 font-mono">
                        V:{result.vectorRank} F:{result.ftsRank}
                      </span>
                    </summary>
                    <pre className="mt-1.5 rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {result.contentPreview}
                    </pre>
                  </details>
                ))
              )}
            </div>
          </details>

          {/* Scenario Section */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Cpu className="size-3.5" />
              Scenario
            </summary>
            <div className="mt-2 pl-5">
              {debugData.scenarioLabel ? (
                <div className="flex items-center gap-2">
                  <span className="font-medium">{debugData.scenarioLabel}</span>
                  {debugData.scenarioConfidence && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        confidenceBadgeClass(debugData.scenarioConfidence)
                      )}
                    >
                      {debugData.scenarioConfidence}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground italic">No scenario matched</p>
              )}
            </div>
          </details>

          {/* Prompt Builder — Side-by-Side */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Layers className="size-3.5" />
              Prompt Builder
              <span className="text-muted-foreground/70 font-normal">
                ({debugData.promptSections.length} sections)
              </span>
            </summary>
            <div className="mt-2">
              <PromptBuilderView
                sections={debugData.promptSections}
                fullPrompt={debugData.systemPrompt}
              />
            </div>
          </details>

          {/* Tokens & Timing */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Clock className="size-3.5" />
              Tokens & Timing
            </summary>
            <div className="mt-2 pl-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Input tokens</span>
                  <p className="font-mono font-medium">
                    {debugData.tokens.input.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Output tokens</span>
                  <p className="font-mono font-medium">
                    {debugData.tokens.output.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Response time</span>
                  <p className="font-mono font-medium">
                    {debugData.responseTimeMs.toLocaleString()}ms
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Model</span>
                  <p className="font-mono font-medium">{debugData.model}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Stop reason</span>
                  <p className="font-mono font-medium">{debugData.stopReason}</p>
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
