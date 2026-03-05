import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Plus, FileText, Upload, Trash2, Loader2, X, ChevronDown, ChevronUp,
  RotateCw, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import type { KBEntry, KBChunk } from '@/hooks/useCompanyKB';
import { cn } from '@/lib/utils';

interface Props {
  entries: KBEntry[];
  onAdd: (entry: { title: string; content: string }) => Promise<unknown>;
  onUpload: (file: File, title?: string) => Promise<unknown>;
  onUpdate: (entryId: string, updates: { title?: string; content?: string }) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
  onFetchChunks?: (entryId: string) => Promise<KBChunk[]>;
  onReembed?: (entryId: string) => Promise<unknown>;
  loading: boolean;
  initialOpen?: boolean;
}

const ACCEPTED_TYPES = '.pdf,.docx,.txt';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EmbeddingStatus({
  status,
  chunkCount,
  onRetry,
}: {
  status?: string;
  chunkCount?: number;
  onRetry?: () => void;
}) {
  if (!status) return null;

  switch (status) {
    case 'completed':
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {chunkCount ? `${chunkCount} chunks` : 'Embedded'}
        </span>
      );
    case 'processing':
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
          Processing
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          <span className="text-red-500">Failed</span>
          {onRetry && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="ml-0.5 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Retry
            </button>
          )}
        </span>
      );
    case 'pending':
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          Pending
        </span>
      );
    default:
      return null;
  }
}

function ChunkViewer({
  chunks,
  loading,
}: {
  chunks: KBChunk[];
  loading: boolean;
}) {
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="space-y-2 pt-2">
        <div className="h-12 animate-pulse rounded bg-muted" />
        <div className="h-12 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <p className="pt-2 text-xs text-muted-foreground">No chunks found.</p>
    );
  }

  return (
    <div className="space-y-1.5 pt-2">
      {chunks.map((chunk) => {
        const isExpanded = expandedChunk === chunk.chunk_index;
        return (
          <div key={chunk.id} className="rounded border bg-muted/30">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              onClick={() => setExpandedChunk(isExpanded ? null : chunk.chunk_index)}
            >
              <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                #{chunk.chunk_index + 1}
              </Badge>
              {chunk.metadata.sectionHeading && (
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  {chunk.metadata.sectionHeading}
                </span>
              )}
              <span className="ml-auto truncate text-[11px] text-muted-foreground max-w-[200px]">
                {chunk.content.slice(0, 80)}...
              </span>
              {isExpanded ? (
                <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </button>
            {isExpanded && (
              <div className="border-t px-2.5 py-2">
                {chunk.metadata.sectionHierarchy.length > 0 && (
                  <p className="mb-1.5 text-[10px] font-medium text-primary">
                    {chunk.metadata.sectionHierarchy.join(' > ')}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                  {chunk.content}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EntryCard({
  entry,
  onUpdate,
  onDelete,
  onFetchChunks,
  onReembed,
}: {
  entry: KBEntry;
  onUpdate: (updates: { title?: string; content?: string }) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onFetchChunks?: () => Promise<KBChunk[]>;
  onReembed?: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const [showFullContent, setShowFullContent] = useState(false);

  // Chunk viewer state
  const [showChunks, setShowChunks] = useState(false);
  const [chunks, setChunks] = useState<KBChunk[] | null>(null);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({ title, content });
      setEditing(false);
      setChunks(null); // Reset chunks since content may have changed
      setShowChunks(false);
      toast.success('Entry updated');
    } catch {
      toast.error('Failed to update entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      toast.success('Entry deleted');
    } catch {
      toast.error('Failed to delete entry');
    } finally {
      setDeleting(false);
    }
  };

  const handleReembed = async () => {
    if (!onReembed) return;
    setReembedding(true);
    try {
      await onReembed();
      toast.success('Re-embedding started');
    } catch {
      toast.error('Failed to re-embed');
    } finally {
      setReembedding(false);
    }
  };

  const handleToggleChunks = async () => {
    if (showChunks) {
      setShowChunks(false);
      return;
    }
    setShowChunks(true);
    if (!chunks && onFetchChunks) {
      setLoadingChunks(true);
      try {
        const result = await onFetchChunks();
        setChunks(result);
      } catch {
        toast.error('Failed to load chunks');
      } finally {
        setLoadingChunks(false);
      }
    }
  };

  return (
    <div className="rounded-lg border">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2.5"
        onClick={() => !editing && setExpanded(!expanded)}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.title}</p>
        </div>
        <EmbeddingStatus
          status={entry.embedding_status}
          chunkCount={entry.chunk_count}
          onRetry={onReembed ? handleReembed : undefined}
        />
        <Badge variant="outline" className="shrink-0 text-xs">
          {entry.source_type === 'file' ? entry.file_name?.split('.').pop()?.toUpperCase() || 'FILE' : 'TEXT'}
        </Badge>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>

      {expanded && (
        <div className="border-t px-3 py-3 space-y-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Content</Label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
                  {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setTitle(entry.title); setContent(entry.content); }} className="h-7 text-xs">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className={cn("overflow-y-auto rounded bg-muted/50 p-2", !showFullContent && "max-h-32")}>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {showFullContent ? entry.content : entry.content.slice(0, 500)}{!showFullContent && entry.content.length > 500 ? '...' : ''}
                </p>
              </div>
              {entry.content.length > 500 && (
                <button
                  type="button"
                  onClick={() => setShowFullContent(!showFullContent)}
                  className="text-xs text-primary hover:underline"
                >
                  {showFullContent ? 'Show less' : 'Show more'}
                </button>
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-7 text-xs">
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                >
                  {deleting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                  Delete
                </Button>
                {entry.embedding_status === 'failed' && onReembed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReembed}
                    disabled={reembedding}
                    className="h-7 text-xs"
                  >
                    {reembedding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
                    Re-embed
                  </Button>
                )}
                {entry.embedding_status === 'completed' && onFetchChunks && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleChunks}
                    className="ml-auto h-7 text-xs"
                  >
                    <Layers className="mr-1 h-3 w-3" />
                    {showChunks ? 'Hide Chunks' : `View ${entry.chunk_count || ''} Chunks`}
                  </Button>
                )}
              </div>

              {/* Chunk viewer */}
              {showChunks && (
                <ChunkViewer chunks={chunks || []} loading={loadingChunks} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBase({ entries, onAdd, onUpload, onUpdate, onDelete, onFetchChunks, onReembed, loading, initialOpen }: Props) {
  const [showAddForm, setShowAddForm] = useState(!!initialOpen);
  const [addMode, setAddMode] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddText = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setAdding(true);
    try {
      await onAdd({ title: title.trim(), content: content.trim() });
      setTitle('');
      setContent('');
      setShowAddForm(false);
      toast.success('Knowledge base entry added');
    } catch {
      toast.error('Failed to add entry');
    } finally {
      setAdding(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    setSelectedFile(file);
    if (!title) {
      setTitle(file.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      await onUpload(selectedFile, title || undefined);
      setSelectedFile(null);
      setTitle('');
      setShowAddForm(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.success('File uploaded and processed');
    } catch {
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Knowledge Base</p>
        {!showAddForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="h-7 gap-1.5 text-xs"
          >
            <Plus className="h-3 w-3" />
            Add Entry
          </Button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => { setAddMode('text'); setSelectedFile(null); }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  addMode === 'text' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setAddMode('file')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  addMode === 'file' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                File Upload
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAddForm(false); setTitle(''); setContent(''); setSelectedFile(null); }}
              className="h-7 w-7 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Product FAQ, Business Hours, Return Policy"
              className="h-8 text-sm"
            />
          </div>

          {addMode === 'text' ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Content</Label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={5}
                  placeholder="Paste or type the information the AI should reference..."
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <Button size="sm" onClick={handleAddText} disabled={adding} className="h-8 text-xs">
                {adding ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Plus className="mr-1.5 h-3 w-3" />}
                Add Entry
              </Button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={handleFileSelect}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="h-7 w-7 p-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload a file</p>
                    <p className="text-xs text-muted-foreground">PDF, DOCX, or TXT (max 10MB)</p>
                  </div>
                </button>
              )}

              {selectedFile && (
                <Button size="sm" onClick={handleUploadFile} disabled={uploading} className="h-8 text-xs">
                  {uploading ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Upload className="mr-1.5 h-3 w-3" />}
                  {uploading ? 'Processing...' : 'Upload & Process'}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Entry list */}
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onUpdate={(updates) => onUpdate(entry.id, updates)}
              onDelete={() => onDelete(entry.id)}
              onFetchChunks={onFetchChunks ? () => onFetchChunks(entry.id) : undefined}
              onReembed={onReembed ? () => onReembed(entry.id) : undefined}
            />
          ))}
        </div>
      ) : (
        !showAddForm && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No knowledge base entries yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Add documents or text to help your AI provide accurate responses.
            </p>
          </div>
        )
      )}
    </div>
  );
}
