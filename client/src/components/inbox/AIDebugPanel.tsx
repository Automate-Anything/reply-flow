import { useState } from 'react';
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

export default function AIDebugPanel({ debugData }: AIDebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);

  const PROMPT_TRUNCATE_LENGTH = 500;
  const promptTruncated =
    debugData.systemPrompt.length > PROMPT_TRUNCATE_LENGTH && !showFullPrompt;
  const displayedPrompt = promptTruncated
    ? debugData.systemPrompt.slice(0, PROMPT_TRUNCATE_LENGTH) + '...'
    : debugData.systemPrompt;

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

          {/* Prompt Sections */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Brain className="size-3.5" />
              Prompt Sections
              <span className="text-muted-foreground/70 font-normal">
                ({debugData.promptSections.length})
              </span>
            </summary>
            <div className="mt-2 space-y-1.5 pl-5">
              {debugData.promptSections.map((section, i) => (
                <details key={i} className="rounded bg-muted/30 p-2">
                  <summary className="cursor-pointer font-medium">
                    {section.name}
                  </summary>
                  <pre className="mt-1.5 rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                    {section.content}
                  </pre>
                </details>
              ))}
            </div>
          </details>

          {/* System Prompt */}
          <details>
            <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Cpu className="size-3.5" />
              System Prompt
            </summary>
            <div className="mt-2 pl-5">
              <div className="flex items-center justify-between mb-1.5">
                <CopyButton text={debugData.systemPrompt} />
                {debugData.systemPrompt.length > PROMPT_TRUNCATE_LENGTH && (
                  <button
                    onClick={() => setShowFullPrompt(!showFullPrompt)}
                    className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
                  >
                    {showFullPrompt ? 'Truncate' : 'Show full'}
                  </button>
                )}
              </div>
              <pre className="rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {displayedPrompt}
              </pre>
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
