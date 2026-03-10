import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  Loader2,
  X,
  FileText,
  CheckCircle2,
  MessageSquare,
  Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProfileData } from '@/hooks/useCompanyAI';

interface CreateFromLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (files: File[]) => Promise<{ name: string; profile_data: ProfileData }>;
  onCreate: (body: { name: string; profile_data: ProfileData }) => Promise<{ id: string }>;
}

type Step = 'upload' | 'analyzing' | 'review';

const ACCEPTED_EXTENSIONS = '.txt,.csv,.json,.pdf,.docx,.xlsx,.xls,.md,.html';
const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TONE_LABELS: Record<string, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
  formal: 'Formal',
};

const LENGTH_LABELS: Record<string, string> = {
  concise: 'Concise',
  moderate: 'Moderate',
  detailed: 'Detailed',
};

const EMOJI_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  moderate: 'Moderate',
};

export default function CreateFromLogsDialog({
  open,
  onOpenChange,
  onGenerate,
  onCreate,
}: CreateFromLogsDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [generatedName, setGeneratedName] = useState('');
  const [generatedProfile, setGeneratedProfile] = useState<ProfileData | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep('upload');
    setFiles([]);
    setDragOver(false);
    setGeneratedName('');
    setGeneratedProfile(null);
    setSaving(false);
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const addFiles = (newFiles: FileList | File[]) => {
    const toAdd = Array.from(newFiles);
    const errors: string[] = [];

    const valid = toAdd.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`${f.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });

    if (errors.length > 0) {
      toast.error(errors.join('. '));
    }

    setFiles((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files allowed`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    setStep('analyzing');
    try {
      const result = await onGenerate(files);
      setGeneratedName(result.name);
      setGeneratedProfile(result.profile_data);
      setStep('review');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to analyze conversations. Please try again.';
      toast.error(msg);
      setStep('upload');
    }
  };

  const handleCreate = async () => {
    if (!generatedProfile) return;
    setSaving(true);
    try {
      const agent = await onCreate({ name: generatedName || 'New Agent', profile_data: generatedProfile });
      toast.success('Agent created from conversation logs');
      handleOpenChange(false);
      // Navigation is handled by the parent component
      return agent;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 402) {
        toast.error('Agent limit reached. Upgrade your plan to add more agents.');
      } else {
        toast.error('Failed to create agent');
      }
      setSaving(false);
    }
  };

  const flow = generatedProfile?.response_flow;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Create Agent from Conversations'}
            {step === 'analyzing' && 'Analyzing Conversations'}
            {step === 'review' && 'Review Generated Agent'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Upload ─────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload files containing conversation logs between your business and customers. We'll analyze them to auto-configure an AI agent.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />

            <div
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-8 w-8 text-muted-foreground/40" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop files here or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  TXT, CSV, JSON, PDF, DOCX, XLSX — up to {MAX_FILES} files, 10MB each
                </p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleAnalyze} disabled={files.length === 0}>
                <MessageSquare className="mr-1.5 h-4 w-4" />
                Analyze Conversations
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Analyzing ──────────────────────────── */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">Analyzing conversation patterns...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This may take 10-20 seconds
              </p>
            </div>
          </div>
        )}

        {/* ── Step 3: Review ─────────────────────────────── */}
        {step === 'review' && generatedProfile && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input
                id="agent-name"
                value={generatedName}
                onChange={(e) => setGeneratedName(e.target.value)}
                placeholder="Agent name"
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              {/* Business Details */}
              {(generatedProfile.business_name || generatedProfile.business_type) && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Business Details</p>
                  <p className="text-sm">
                    {[generatedProfile.business_name, generatedProfile.business_type].filter(Boolean).join(' — ')}
                  </p>
                  {generatedProfile.business_description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{generatedProfile.business_description}</p>
                  )}
                </div>
              )}

              {/* Communication Style */}
              {flow?.default_style && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Communication Style</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {flow.default_style.tone && (
                      <Badge variant="secondary">{TONE_LABELS[flow.default_style.tone] || flow.default_style.tone}</Badge>
                    )}
                    {flow.default_style.response_length && (
                      <Badge variant="secondary">{LENGTH_LABELS[flow.default_style.response_length] || flow.default_style.response_length}</Badge>
                    )}
                    {flow.default_style.emoji_usage && (
                      <Badge variant="secondary">Emoji: {EMOJI_LABELS[flow.default_style.emoji_usage] || flow.default_style.emoji_usage}</Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Language */}
              {generatedProfile.language_preference && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Language</p>
                  <p className="text-sm">
                    {generatedProfile.language_preference === 'match_customer'
                      ? 'Match customer language'
                      : generatedProfile.language_preference}
                  </p>
                </div>
              )}

              {/* Scenarios */}
              {flow && flow.scenarios.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Scenarios ({flow.scenarios.length})
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {flow.scenarios.map((s) => (
                      <Badge key={s.id} variant="outline">{s.label}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Greeting */}
              {flow?.greeting_message && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Greeting</p>
                  <p className="text-sm italic">"{flow.greeting_message}"</p>
                </div>
              )}

              {/* Response Rules */}
              {flow?.response_rules && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Response Rules</p>
                  <p className="text-sm whitespace-pre-line">{flow.response_rules}</p>
                </div>
              )}

              {/* Topics to Avoid */}
              {flow?.topics_to_avoid && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Topics to Avoid</p>
                  <p className="text-sm">{flow.topics_to_avoid}</p>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              You can fine-tune all settings after creating the agent.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setStep('upload'); }}>
                Back
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="mr-1.5 h-4 w-4" />
                )}
                Create Agent
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
