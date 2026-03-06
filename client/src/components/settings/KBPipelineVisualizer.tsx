import { useState, useEffect, useRef } from 'react';
import { Circle, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, FileText, Database, Cpu, Scissors, Search, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PipelineStepState {
  step: string;
  status: 'pending' | 'started' | 'completed' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  timestamp?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface KBPipelineVisualizerProps {
  events: PipelineStepState[];
  isComplete: boolean;
  error?: string;
}

const PIPELINE_STEPS = [
  { key: 'classification', label: 'Content Classification', description: 'Detecting file type and processing strategy', icon: Search },
  { key: 'extraction', label: 'Text Extraction', description: 'Extracting text from document', icon: FileText },
  { key: 'cleaning', label: 'Text Cleaning', description: 'Normalizing characters and whitespace', icon: Scissors },
  { key: 'chunking', label: 'Document Chunking', description: 'Splitting into semantic chunks', icon: Cpu },
  { key: 'embedding', label: 'Embedding Generation', description: 'Creating vector embeddings', icon: Database },
  { key: 'storing', label: 'Storing Chunks', description: 'Saving chunks to database', icon: Archive },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Live elapsed timer for running steps */
function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-[10px] text-yellow-500 tabular-nums animate-pulse">
      {formatDuration(elapsed)}
    </span>
  );
}

function getStepSummary(stepKey: string, data?: Record<string, unknown>): string | null {
  if (!data) return null;

  switch (stepKey) {
    case 'classification': {
      const strategy = data.strategy ?? data.processingStrategy;
      const contentType = data.contentType ?? data.type;
      const parts: string[] = [];
      if (contentType) parts.push(String(contentType));
      if (strategy) parts.push(String(strategy));
      return parts.length > 0 ? parts.join(' / ') : null;
    }
    case 'extraction': {
      const cleanedLength = data.cleanedLength ?? data.cleaned_length;
      const extractor = data.extractor;
      const parts: string[] = [];
      if (extractor) parts.push(`${extractor} extractor`);
      if (cleanedLength != null) parts.push(`${Number(cleanedLength).toLocaleString()} chars`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'cleaning': {
      const cleanedLength = data.cleanedLength ?? data.cleaned_length;
      const warningCount = data.warningCount ?? data.warnings;
      const parts: string[] = [];
      if (cleanedLength != null) parts.push(`${Number(cleanedLength).toLocaleString()} chars`);
      if (warningCount != null && Number(warningCount) > 0) parts.push(`${warningCount} warnings`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'chunking': {
      const chunkCount = data.chunkCount ?? data.chunk_count ?? data.count;
      const avgChunkSize = data.avgChunkSize ?? data.avg_chunk_size;
      if (chunkCount != null) {
        let result = `${chunkCount} chunks`;
        if (avgChunkSize != null) result += `, avg ${Number(avgChunkSize).toLocaleString()} chars`;
        return result;
      }
      return null;
    }
    case 'embedding': {
      const embeddedCount = data.embeddedCount ?? data.embedded_count ?? data.count;
      const model = data.model;
      const parts: string[] = [];
      if (embeddedCount != null) parts.push(`${embeddedCount} embeddings`);
      if (model) parts.push(String(model));
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'storing': {
      const rowCount = data.rowCount ?? data.row_count ?? data.count;
      if (rowCount != null) return `${rowCount} rows inserted`;
      return null;
    }
    default:
      return null;
  }
}

/** What to show while a step is actively running */
function getRunningMessage(stepKey: string, data?: Record<string, unknown>): string | null {
  if (!data) return null;

  switch (stepKey) {
    case 'classification':
      if (data.fileName) return `Analyzing ${data.fileName} (${formatBytes(Number(data.fileSize ?? 0))})...`;
      return 'Analyzing content...';
    case 'extraction': {
      const extractor = data.extractor;
      if (extractor) return `Extracting with ${extractor} extractor...`;
      return 'Extracting text...';
    }
    case 'cleaning':
      return 'Normalizing text and whitespace...';
    case 'chunking': {
      const strategy = data.strategy;
      const inputLength = data.inputLength;
      const parts: string[] = [];
      if (strategy) parts.push(`Strategy: ${strategy}`);
      if (inputLength != null) parts.push(`${Number(inputLength).toLocaleString()} chars input`);
      return parts.length > 0 ? parts.join(', ') : 'Splitting document...';
    }
    case 'embedding': {
      const totalChunks = data.totalChunks;
      const model = data.model;
      const parts: string[] = [];
      if (model) parts.push(`Model: ${model}`);
      if (totalChunks != null) parts.push(`${totalChunks} chunks to embed`);
      if (data.estimatedTokens != null) parts.push(`~${Number(data.estimatedTokens).toLocaleString()} tokens`);
      return parts.length > 0 ? parts.join(', ') : 'Generating embeddings...';
    }
    case 'storing': {
      const rowCount = data.rowCount;
      if (rowCount != null) return `Inserting ${rowCount} rows...`;
      return 'Saving to database...';
    }
    default:
      return null;
  }
}

// ── Detail Renderers per Step ────────────────────

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'green' | 'blue' | 'yellow' | 'purple' }) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    green: 'bg-green-500/15 text-green-700 dark:text-green-400',
    blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    yellow: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
    purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  };
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', colors[variant])}>
      {children}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-muted-foreground min-w-[90px] shrink-0">{label}</span>
      <span className="text-foreground break-all">{value}</span>
    </div>
  );
}

function ClassificationDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {data.fileName && <DetailRow label="File" value={String(data.fileName)} />}
      {data.fileSize != null && <DetailRow label="Size" value={formatBytes(Number(data.fileSize))} />}
      {data.mimeType && <DetailRow label="MIME Type" value={String(data.mimeType)} />}
      {data.extension && <DetailRow label="Extension" value={String(data.extension)} />}
      {data.strategy && <DetailRow label="Strategy" value={<Badge variant="blue">{String(data.strategy)}</Badge>} />}
      {data.contentType && <DetailRow label="Content Type" value={<Badge variant="purple">{String(data.contentType)}</Badge>} />}
      {data.confidence && <DetailRow label="Confidence" value={
        <Badge variant={data.confidence === 'high' ? 'green' : 'yellow'}>
          {String(data.confidence)}
        </Badge>
      } />}
    </div>
  );
}

function ExtractionDetail({ data }: { data: Record<string, unknown> }) {
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const warningTexts = data.warningTexts as string[] | undefined;
  const contentPreview = data.contentPreview as string | undefined;

  return (
    <div className="space-y-2">
      {data.extractor && <DetailRow label="Extractor" value={<Badge variant="blue">{String(data.extractor)}</Badge>} />}
      {data.cleanedLength != null && <DetailRow label="Cleaned Text" value={`${Number(data.cleanedLength).toLocaleString()} chars`} />}
      {data.structuredLength != null && <DetailRow label="Structured Text" value={`${Number(data.structuredLength).toLocaleString()} chars`} />}

      {metadata && (
        <div className="mt-1.5 space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Metadata</p>
          <div className="bg-muted/50 rounded p-2 space-y-1">
            {metadata.title && <DetailRow label="Title" value={String(metadata.title)} />}
            {metadata.author && <DetailRow label="Author" value={String(metadata.author)} />}
            {metadata.pageCount != null && <DetailRow label="Pages" value={String(metadata.pageCount)} />}
            {metadata.sourceType && <DetailRow label="Source Type" value={String(metadata.sourceType)} />}
            {metadata.rowCount != null && <DetailRow label="Rows" value={String(metadata.rowCount)} />}
            {metadata.language && <DetailRow label="Language" value={String(metadata.language)} />}
            {metadata.schema && (
              <DetailRow label="Schema" value={
                <span className="font-mono text-[10px]">{JSON.stringify(metadata.schema)}</span>
              } />
            )}
          </div>
        </div>
      )}

      {warningTexts && warningTexts.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">Warnings</p>
          {warningTexts.map((w, i) => (
            <p key={i} className="text-[11px] text-yellow-600 dark:text-yellow-400 mt-0.5">{w}</p>
          ))}
        </div>
      )}

      {contentPreview && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Content Preview</p>
          <pre className="mt-0.5 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground font-mono leading-relaxed">
            {contentPreview}
          </pre>
        </div>
      )}
    </div>
  );
}

function CleaningDetail({ data }: { data: Record<string, unknown> }) {
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const warningTexts = data.warningTexts as string[] | undefined;

  return (
    <div className="space-y-1.5">
      {data.cleanedLength != null && <DetailRow label="Cleaned" value={`${Number(data.cleanedLength).toLocaleString()} chars`} />}
      {data.structuredLength != null && <DetailRow label="Structured" value={`${Number(data.structuredLength).toLocaleString()} chars`} />}

      {metadata && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Document Info</p>
          <div className="bg-muted/50 rounded p-2 space-y-1">
            {metadata.sourceType && <DetailRow label="Source Type" value={String(metadata.sourceType)} />}
            {metadata.contentType && <DetailRow label="Content Type" value={String(metadata.contentType)} />}
            {metadata.strategy && <DetailRow label="Strategy" value={String(metadata.strategy)} />}
          </div>
        </div>
      )}

      {warningTexts && warningTexts.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-yellow-600 dark:text-yellow-400">Warnings:</p>
          {warningTexts.map((w, i) => (
            <p key={i} className="text-[11px] text-yellow-600 dark:text-yellow-400">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChunkPreview {
  index: number;
  size: number;
  sectionHeading: string | null;
  sectionHierarchy: string[];
  preview: string;
}

function ChunkingDetail({ data }: { data: Record<string, unknown> }) {
  const [showAllChunks, setShowAllChunks] = useState(false);
  const chunkPreviews = data.chunkPreviews as ChunkPreview[] | undefined;
  const sectionHeadings = data.sectionHeadings as string[] | undefined;
  const chunkSizes = data.chunkSizes as number[] | undefined;
  const chunkCount = Number(data.chunkCount ?? 0);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <DetailRow label="Chunks" value={String(data.chunkCount ?? 0)} />
        <DetailRow label="Avg Size" value={`${Number(data.avgChunkSize ?? 0).toLocaleString()} chars`} />
        <DetailRow label="Min Size" value={`${Number(data.minChunkSize ?? 0).toLocaleString()} chars`} />
        <DetailRow label="Max Size" value={`${Number(data.maxChunkSize ?? 0).toLocaleString()} chars`} />
      </div>

      {sectionHeadings && sectionHeadings.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sections Detected</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {sectionHeadings.map((h, i) => (
              <Badge key={i} variant="purple">{h}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Chunk size distribution bar */}
      {chunkSizes && chunkSizes.length > 1 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Size Distribution</p>
          <div className="flex items-end gap-px mt-1 h-8">
            {chunkSizes.map((size, i) => {
              const maxSize = Math.max(...chunkSizes);
              const height = maxSize > 0 ? Math.max(4, (size / maxSize) * 32) : 4;
              return (
                <div
                  key={i}
                  className="bg-blue-500/60 rounded-t-sm min-w-[4px] flex-1 max-w-[12px]"
                  style={{ height: `${height}px` }}
                  title={`Chunk ${i + 1}: ${size.toLocaleString()} chars`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
            <span>Chunk 1</span>
            <span>Chunk {chunkSizes.length}</span>
          </div>
        </div>
      )}

      {/* Chunk previews */}
      {chunkPreviews && chunkPreviews.length > 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowAllChunks(!showAllChunks)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            {showAllChunks ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Chunk Previews ({chunkCount})
          </button>
          {showAllChunks && (
            <div className="mt-1 space-y-1.5 max-h-60 overflow-y-auto">
              {chunkPreviews.map((chunk) => (
                <div key={chunk.index} className="bg-muted/50 rounded p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="default">#{chunk.index + 1}</Badge>
                    <span className="text-[10px] text-muted-foreground">{chunk.size.toLocaleString()} chars</span>
                    {chunk.sectionHeading && (
                      <Badge variant="purple">{chunk.sectionHeading}</Badge>
                    )}
                  </div>
                  {chunk.sectionHierarchy.length > 0 && (
                    <p className="text-[9px] text-muted-foreground mb-1">
                      {chunk.sectionHierarchy.join(' > ')}
                    </p>
                  )}
                  <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {chunk.preview}{chunk.size > 200 ? '...' : ''}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmbeddingDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {data.embeddedCount != null && <DetailRow label="Embeddings" value={String(data.embeddedCount)} />}
      {data.model && <DetailRow label="Model" value={<Badge variant="blue">{String(data.model)}</Badge>} />}
      {data.dimensions != null && <DetailRow label="Dimensions" value={String(data.dimensions)} />}
      {data.estimatedTokens != null && <DetailRow label="Est. Tokens" value={`~${Number(data.estimatedTokens).toLocaleString()}`} />}
    </div>
  );
}

function StoringDetail({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {data.rowCount != null && <DetailRow label="Rows" value={String(data.rowCount)} />}
      {data.totalContentSize != null && <DetailRow label="Total Size" value={`${Number(data.totalContentSize).toLocaleString()} chars`} />}
      {data.entryId && <DetailRow label="Entry ID" value={
        <span className="font-mono text-[10px]">{String(data.entryId).slice(0, 12)}...</span>
      } />}
      {data.knowledgeBaseId && <DetailRow label="KB ID" value={
        <span className="font-mono text-[10px]">{String(data.knowledgeBaseId).slice(0, 12)}...</span>
      } />}
    </div>
  );
}

function StepDetailPanel({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) {
  switch (stepKey) {
    case 'classification': return <ClassificationDetail data={data} />;
    case 'extraction': return <ExtractionDetail data={data} />;
    case 'cleaning': return <CleaningDetail data={data} />;
    case 'chunking': return <ChunkingDetail data={data} />;
    case 'embedding': return <EmbeddingDetail data={data} />;
    case 'storing': return <StoringDetail data={data} />;
    default: return null;
  }
}

// ── Main Component ───────────────────────────────

function StepIcon({ status }: { status: 'pending' | 'started' | 'completed' | 'error' }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'started':
      return <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'pending':
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

interface MergedStepState extends PipelineStepState {
  mergedData?: Record<string, unknown>;
}

export default function KBPipelineVisualizer({ events, isComplete, error: externalError }: KBPipelineVisualizerProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const prevActiveStepRef = useRef<string | null>(null);

  const toggleStep = (key: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Build a map of step -> merged state (tracking start/complete timestamps and merging data)
  const eventMap = new Map<string, MergedStepState>();
  for (const event of events) {
    const existing = eventMap.get(event.step);
    if (!existing) {
      eventMap.set(event.step, {
        ...event,
        mergedData: event.data ? { ...event.data } : undefined,
        startedAt: event.status === 'started' ? (event.timestamp ?? Date.now()) : undefined,
        completedAt: event.status === 'completed' ? (event.timestamp ?? Date.now()) : undefined,
      });
    } else {
      const mergedData = { ...(existing.mergedData ?? {}), ...(event.data ?? {}) };
      eventMap.set(event.step, {
        ...existing,
        ...event,
        mergedData,
        data: event.data ?? existing.data,
        startedAt: existing.startedAt ?? (event.status === 'started' ? (event.timestamp ?? Date.now()) : undefined),
        completedAt: event.status === 'completed' ? (event.timestamp ?? Date.now()) : existing.completedAt,
      });
    }
  }

  // Auto-expand the currently running step and auto-expand when completed
  const currentActiveStep = PIPELINE_STEPS.find((s) => eventMap.get(s.key)?.status === 'started')?.key ?? null;

  useEffect(() => {
    if (currentActiveStep && currentActiveStep !== prevActiveStepRef.current) {
      setExpandedSteps((prev) => {
        const next = new Set(prev);
        next.add(currentActiveStep);
        return next;
      });
      prevActiveStepRef.current = currentActiveStep;
    }
  }, [currentActiveStep]);

  // Auto-expand steps when they complete (so the user sees the detail data arrive)
  const completedStepsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const step of PIPELINE_STEPS) {
      const event = eventMap.get(step.key);
      if (event?.status === 'completed' && !completedStepsRef.current.has(step.key)) {
        completedStepsRef.current.add(step.key);
        setExpandedSteps((prev) => {
          const next = new Set(prev);
          next.add(step.key);
          return next;
        });
      }
    }
  });

  const completedCount = PIPELINE_STEPS.filter(
    (s) => eventMap.get(s.key)?.status === 'completed'
  ).length;

  const hasError = events.some((e) => e.status === 'error');
  const errorEvent = events.find((e) => e.status === 'error');

  // Calculate total pipeline duration
  const allTimestamps = events.map((e) => e.timestamp).filter(Boolean) as number[];
  const totalDuration = allTimestamps.length >= 2
    ? formatDuration(Math.max(...allTimestamps) - Math.min(...allTimestamps))
    : null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Processing Pipeline</p>
          {!isComplete && currentActiveStep && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
              <span className="text-[10px] text-yellow-600 dark:text-yellow-400">Live</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalDuration && isComplete && (
            <span className="text-[10px] text-muted-foreground">Total: {totalDuration}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {completedCount}/{PIPELINE_STEPS.length} steps
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            hasError ? 'bg-red-500' : 'bg-green-500'
          )}
          style={{ width: `${(completedCount / PIPELINE_STEPS.length) * 100}%` }}
        />
      </div>

      {/* Step list */}
      <div className="space-y-0">
        {PIPELINE_STEPS.map((step, index) => {
          const event = eventMap.get(step.key);
          const status = event?.status ?? 'pending';
          const isLast = index === PIPELINE_STEPS.length - 1;
          const summary = status === 'completed' ? getStepSummary(step.key, event?.mergedData ?? event?.data) : null;
          const runningMessage = status === 'started' ? getRunningMessage(step.key, event?.mergedData ?? event?.data) : null;
          const duration =
            event?.startedAt && event?.completedAt
              ? formatDuration(event.completedAt - event.startedAt)
              : null;
          const isExpanded = expandedSteps.has(step.key);
          const hasDetail = (status === 'completed' || status === 'started') && (event?.mergedData ?? event?.data);
          const StepIconComponent = step.icon;

          return (
            <div key={step.key} className={cn(
              'flex transition-all duration-300',
              status === 'started' && 'bg-yellow-500/5 -mx-2 px-2 rounded-md'
            )}>
              {/* Icon column with connecting line */}
              <div className="flex flex-col items-center mr-3">
                <StepIcon status={status} />
                {!isLast && (
                  <div
                    className={cn(
                      'w-0 flex-1 border-l-2 my-1 transition-colors duration-300',
                      status === 'completed'
                        ? 'border-green-500/40'
                        : 'border-muted-foreground/20'
                    )}
                  />
                )}
              </div>

              {/* Content */}
              <div className={cn('flex-1 pb-4', isLast && 'pb-0')}>
                <div
                  className={cn(
                    'flex items-center gap-2',
                    hasDetail && 'cursor-pointer hover:opacity-80'
                  )}
                  onClick={() => hasDetail && toggleStep(step.key)}
                >
                  <StepIconComponent className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    status === 'pending' ? 'text-muted-foreground/40' : 'text-muted-foreground',
                    status === 'started' && 'text-yellow-600 dark:text-yellow-400'
                  )} />
                  <span
                    className={cn(
                      'text-sm font-medium',
                      status === 'pending' && 'text-muted-foreground/50',
                      status === 'started' && 'text-yellow-700 dark:text-yellow-300',
                      status === 'error' && 'text-red-500'
                    )}
                  >
                    {step.label}
                  </span>
                  {/* Live timer for running step */}
                  {status === 'started' && event?.startedAt && (
                    <LiveTimer startedAt={event.startedAt} />
                  )}
                  {/* Final duration for completed step */}
                  {duration && (
                    <span className="text-[10px] text-muted-foreground">{duration}</span>
                  )}
                  {hasDetail && (
                    isExpanded
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                  )}
                </div>

                {/* Running message while step is active */}
                {status === 'started' && runningMessage && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 ml-5.5 animate-pulse">
                    {runningMessage}
                  </p>
                )}

                {/* Description for pending/completed */}
                {status !== 'started' && (
                  <p
                    className={cn(
                      'text-xs ml-5.5',
                      status === 'pending'
                        ? 'text-muted-foreground/40'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step.description}
                  </p>
                )}

                {summary && !isExpanded && (
                  <p className="mt-0.5 ml-5.5 text-xs text-green-600 dark:text-green-400">
                    {summary}
                  </p>
                )}

                {status === 'error' && event?.error && (
                  <p className="mt-0.5 ml-5.5 text-xs text-red-500">
                    {event.error}
                  </p>
                )}

                {/* Expanded detail panel */}
                {isExpanded && hasDetail && (
                  <div className={cn(
                    'mt-2 ml-5.5 p-3 rounded-md transition-all duration-300',
                    status === 'started'
                      ? 'bg-yellow-500/10 border border-dashed border-yellow-500/30'
                      : 'bg-muted/30 border border-dashed border-muted-foreground/20'
                  )}>
                    <StepDetailPanel stepKey={step.key} data={(event?.mergedData ?? event?.data) as Record<string, unknown>} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion / Error banner */}
      {isComplete && !hasError && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            Pipeline completed successfully
          </span>
          {totalDuration && (
            <span className="text-xs text-green-600 dark:text-green-500 ml-auto">{totalDuration}</span>
          )}
        </div>
      )}

      {isComplete && hasError && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2">
          <XCircle className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium text-red-700 dark:text-red-400">
            {errorEvent?.error ?? 'Pipeline failed'}
          </span>
        </div>
      )}
    </div>
  );
}
