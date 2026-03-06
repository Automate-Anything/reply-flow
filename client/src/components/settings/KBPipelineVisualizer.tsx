import { Circle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
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
  { key: 'classification', label: 'Content Classification', description: 'Detecting file type and processing strategy' },
  { key: 'extraction', label: 'Text Extraction', description: 'Extracting text from document' },
  { key: 'cleaning', label: 'Text Cleaning', description: 'Normalizing characters and whitespace' },
  { key: 'chunking', label: 'Document Chunking', description: 'Splitting into semantic chunks' },
  { key: 'embedding', label: 'Embedding Generation', description: 'Creating vector embeddings' },
  { key: 'storing', label: 'Storing Chunks', description: 'Saving chunks to database' },
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getStepDetail(stepKey: string, data?: Record<string, unknown>): string | null {
  if (!data) return null;

  switch (stepKey) {
    case 'classification': {
      const strategy = data.strategy ?? data.processingStrategy;
      const contentType = data.contentType ?? data.type;
      if (strategy || contentType) {
        const parts: string[] = [];
        if (strategy) parts.push(`Strategy: ${strategy}`);
        if (contentType) parts.push(`Type: ${contentType}`);
        return parts.join(', ');
      }
      return null;
    }
    case 'extraction': {
      const cleanedLength = data.cleanedLength ?? data.cleaned_length;
      const structuredLength = data.structuredLength ?? data.structured_length;
      if (cleanedLength != null || structuredLength != null) {
        const parts: string[] = [];
        if (cleanedLength != null) parts.push(`Cleaned: ${Number(cleanedLength).toLocaleString()} chars`);
        if (structuredLength != null) parts.push(`Structured: ${Number(structuredLength).toLocaleString()} chars`);
        return parts.join(', ');
      }
      return null;
    }
    case 'chunking': {
      const chunkCount = data.chunkCount ?? data.chunk_count ?? data.count;
      const avgChunkSize = data.avgChunkSize ?? data.avg_chunk_size ?? data.avgSize;
      if (chunkCount != null) {
        let result = `${chunkCount} chunks`;
        if (avgChunkSize != null) result += `, avg ${Number(avgChunkSize).toLocaleString()} chars`;
        return result;
      }
      return null;
    }
    case 'embedding': {
      const embeddedCount = data.embeddedCount ?? data.embedded_count ?? data.count;
      if (embeddedCount != null) return `${embeddedCount} embeddings generated`;
      return null;
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

export default function KBPipelineVisualizer({ events, isComplete, error: externalError }: KBPipelineVisualizerProps) {
  // Build a map of step -> merged state (tracking start/complete timestamps)
  const eventMap = new Map<string, PipelineStepState>();
  for (const event of events) {
    const existing = eventMap.get(event.step);
    if (!existing) {
      eventMap.set(event.step, {
        ...event,
        startedAt: event.status === 'started' ? (event.timestamp ?? Date.now()) : undefined,
        completedAt: event.status === 'completed' ? (event.timestamp ?? Date.now()) : undefined,
      });
    } else {
      eventMap.set(event.step, {
        ...existing,
        ...event,
        startedAt: existing.startedAt ?? (event.status === 'started' ? (event.timestamp ?? Date.now()) : undefined),
        completedAt: event.status === 'completed' ? (event.timestamp ?? Date.now()) : existing.completedAt,
      });
    }
  }

  const completedCount = PIPELINE_STEPS.filter(
    (s) => eventMap.get(s.key)?.status === 'completed'
  ).length;

  const hasError = events.some((e) => e.status === 'error');
  const errorEvent = events.find((e) => e.status === 'error');

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Processing Pipeline</p>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{PIPELINE_STEPS.length} steps
        </span>
      </div>

      {/* Step list */}
      <div className="space-y-0">
        {PIPELINE_STEPS.map((step, index) => {
          const event = eventMap.get(step.key);
          const status = event?.status ?? 'pending';
          const isLast = index === PIPELINE_STEPS.length - 1;
          const detail = status === 'completed' ? getStepDetail(step.key, event?.data) : null;
          const duration =
            event?.startedAt && event?.completedAt
              ? formatDuration(event.completedAt - event.startedAt)
              : null;

          return (
            <div key={step.key} className="flex">
              {/* Icon column with connecting line */}
              <div className="flex flex-col items-center mr-3">
                <StepIcon status={status} />
                {!isLast && (
                  <div
                    className={cn(
                      'w-0 flex-1 border-l-2 my-1',
                      status === 'completed'
                        ? 'border-green-500/40'
                        : 'border-muted-foreground/20'
                    )}
                  />
                )}
              </div>

              {/* Content */}
              <div className={cn('flex-1 pb-4', isLast && 'pb-0')}>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      status === 'pending' && 'text-muted-foreground/50',
                      status === 'error' && 'text-red-500'
                    )}
                  >
                    {step.label}
                  </span>
                  {duration && (
                    <span className="text-[10px] text-muted-foreground">{duration}</span>
                  )}
                </div>

                <p
                  className={cn(
                    'text-xs',
                    status === 'pending'
                      ? 'text-muted-foreground/40'
                      : 'text-muted-foreground'
                  )}
                >
                  {step.description}
                </p>

                {detail && (
                  <p className="mt-0.5 text-xs text-green-600 dark:text-green-400">
                    {detail}
                  </p>
                )}

                {status === 'error' && event?.error && (
                  <p className="mt-0.5 text-xs text-red-500">
                    {event.error}
                  </p>
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
