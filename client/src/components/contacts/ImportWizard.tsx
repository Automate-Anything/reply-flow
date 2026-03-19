import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import TagInput from './TagInput';
import type { ContactTag } from '@/hooks/useContactTags';
import type { ContactList } from '@/hooks/useContactLists';
import type { CustomFieldDefinition } from '@/hooks/useCustomFields';

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  availableTags: ContactTag[];
  availableLists: ContactList[];
  customFieldDefinitions: CustomFieldDefinition[];
}

interface ParseResult {
  sessionId: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMappings: Record<string, string>;
}

interface PreviewResult {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateCount: number;
  warnings: { row: number; field: string; message: string }[];
  errors: { row: number; field: string; message: string }[];
  duplicates: { row: number; phone: string }[];
  preview: (Record<string, unknown> & { _status: string; _row: number })[];
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

type DuplicateHandling = 'skip' | 'overwrite' | 'merge';

const STANDARD_FIELDS = [
  { value: 'phone_number', label: 'Phone Number' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'notes', label: 'Notes' },
  { value: 'tags', label: 'Tags' },
  { value: 'address_street', label: 'Street' },
  { value: 'address_city', label: 'City' },
  { value: 'address_state', label: 'State' },
  { value: 'address_postal_code', label: 'Postal Code' },
  { value: 'address_country', label: 'Country' },
];

const STEPS = ['Upload', 'Map Fields', 'Settings', 'Preview', 'Import'];

export default function ImportWizard({
  open,
  onOpenChange,
  onComplete,
  availableTags,
  availableLists,
  customFieldDefinitions,
}: ImportWizardProps) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateHandling>('skip');
  const [listId, setListId] = useState<string>('');
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep(0);
    setFile(null);
    setUploading(false);
    setParseResult(null);
    setMappings({});
    setDuplicateHandling('skip');
    setListId('');
    setDefaultTags([]);
    setPreviewing(false);
    setPreviewResult(null);
    setImporting(false);
    setImportResult(null);
    setDragOver(false);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  // ── Step 1: Upload ────────────────────────────────────────────────────────

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const { data } = await api.post('/contacts/import/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setParseResult(data);
      setMappings(data.suggestedMappings || {});
      setStep(1);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to parse file';
      toast.error(msg);
      setFile(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  // ── Step 4: Preview ───────────────────────────────────────────────────────

  const handlePreview = async () => {
    if (!parseResult) return;
    setPreviewing(true);
    try {
      const { data } = await api.post('/contacts/import/preview', {
        sessionId: parseResult.sessionId,
        mappings,
        settings: { duplicateHandling, listId: listId || undefined, defaultTags: defaultTags.length > 0 ? defaultTags : undefined },
      });
      setPreviewResult(data);
      setStep(3);
    } catch {
      toast.error('Failed to generate preview');
    } finally {
      setPreviewing(false);
    }
  };

  // ── Step 5: Execute ───────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parseResult) return;
    setImporting(true);
    try {
      const { data } = await api.post('/contacts/import/execute', {
        sessionId: parseResult.sessionId,
        mappings,
        settings: { duplicateHandling, listId: listId || undefined, defaultTags: defaultTags.length > 0 ? defaultTags : undefined },
      });
      setImportResult(data);
      setStep(4);
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  // ── Field options for mapping dropdown ────────────────────────────────────

  const allFieldOptions = [
    ...STANDARD_FIELDS,
    ...customFieldDefinitions.map((d) => ({
      value: `custom:${d.id}`,
      label: d.name,
    })),
  ];

  // Check if at least one identifier (phone or email) is mapped
  const phoneIsMapped = Object.values(mappings).includes('phone_number');
  const emailIsMapped = Object.values(mappings).includes('email');
  const hasIdentifier = phoneIsMapped || emailIsMapped;

  // ── Mapped field names for preview table ──────────────────────────────────

  const mappedFields = Object.entries(mappings)
    .filter(([, v]) => v && v !== 'skip')
    .map(([, v]) => {
      const fieldDef = allFieldOptions.find((f) => f.value === v);
      return { key: v, label: fieldDef?.label || v };
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 border-b pb-3">
          {STEPS.map((name, i) => (
            <div key={name} className="flex items-center gap-1">
              {i > 0 && <div className="h-px w-4 bg-border" />}
              <div className="flex items-center gap-1.5">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    i < step
                      ? 'bg-primary text-primary-foreground'
                      : i === step
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={`text-xs ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>
                  {name}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── STEP 0: Upload ─────────────────────────────────── */}
          {step === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              <div
                className={`flex w-full max-w-md cursor-pointer flex-col items-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Parsing file...</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-muted-foreground/50" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Drop a file here or click to browse</p>
                      <p className="mt-1 text-xs text-muted-foreground">CSV or Excel (.csv, .xlsx, .xls)</p>
                    </div>
                  </>
                )}
              </div>
              {file && !uploading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1: Field Mapping ──────────────────────────── */}
          {step === 1 && parseResult && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {parseResult.totalRows} rows found. Map your file columns to contact fields.
                </p>
                {!hasIdentifier && (
                  <Badge variant="destructive" className="text-xs">
                    Phone Number or Email must be mapped
                  </Badge>
                )}
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">File Column</TableHead>
                      <TableHead className="w-[200px]">Map To</TableHead>
                      <TableHead>Sample Values</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.headers.map((header) => (
                      <TableRow key={header}>
                        <TableCell className="font-medium">{header}</TableCell>
                        <TableCell>
                          <Select
                            value={mappings[header] || 'skip'}
                            onValueChange={(v) =>
                              setMappings((prev) => ({ ...prev, [header]: v }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">-- Skip --</SelectItem>
                              {allFieldOptions.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {parseResult.sampleRows
                            .slice(0, 3)
                            .map((r) => r[header])
                            .filter(Boolean)
                            .join(' · ')
                            || '(empty)'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* ── STEP 2: Settings ───────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-6 py-4">
              <div>
                <Label className="text-sm font-medium">Duplicate Handling</Label>
                <p className="mb-3 text-xs text-muted-foreground">
                  What to do when a contact with the same phone number already exists.
                </p>
                <div className="flex gap-2">
                  {([
                    { value: 'skip', label: 'Skip existing', desc: 'Do not modify existing contacts' },
                    { value: 'overwrite', label: 'Overwrite', desc: 'Replace all fields on existing contacts' },
                    { value: 'merge', label: 'Merge', desc: 'Only fill in empty fields on existing contacts' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDuplicateHandling(opt.value)}
                      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
                        duplicateHandling === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent'
                      }`}
                    >
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {availableLists.length > 0 && (
                <div>
                  <Label className="text-sm font-medium">Add to List (optional)</Label>
                  <Select value={listId || 'none'} onValueChange={(v) => setListId(v === 'none' ? '' : v)}>
                    <SelectTrigger className="mt-2 w-full max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No list</SelectItem>
                      {availableLists.map((list) => (
                        <SelectItem key={list.id} value={list.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: list.color }}
                            />
                            {list.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label className="text-sm font-medium">Default Tags (optional)</Label>
                <p className="mb-2 text-xs text-muted-foreground">
                  These tags will be added to all imported contacts.
                </p>
                <div className="max-w-xs">
                  <TagInput
                    value={defaultTags}
                    onChange={setDefaultTags}
                    availableTags={availableTags}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Preview ────────────────────────────────── */}
          {step === 3 && previewResult && (
            <div className="space-y-4 py-2">
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3">
                <SummaryCard label="Total" value={previewResult.totalRows} />
                <SummaryCard label="Valid" value={previewResult.validRows} color="text-green-600" />
                <SummaryCard label="Warnings" value={previewResult.warningRows} color="text-yellow-600" />
                <SummaryCard label="Errors" value={previewResult.errorRows} color="text-red-600" />
              </div>

              {previewResult.duplicateCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {previewResult.duplicateCount} duplicate phone number{previewResult.duplicateCount !== 1 ? 's' : ''} found.
                  {duplicateHandling === 'skip' && ' These will be skipped.'}
                  {duplicateHandling === 'overwrite' && ' Existing contacts will be overwritten.'}
                  {duplicateHandling === 'merge' && ' Empty fields on existing contacts will be filled.'}
                </div>
              )}

              {/* Preview table */}
              {previewResult.preview.length > 0 && (
                <div className="rounded-lg border">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">Row</TableHead>
                          <TableHead className="w-10">Status</TableHead>
                          {mappedFields.map((f) => (
                            <TableHead key={f.key} className="min-w-[120px]">{f.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewResult.preview.map((row) => (
                          <TableRow key={row._row}>
                            <TableCell className="text-xs text-muted-foreground">{row._row}</TableCell>
                            <TableCell>
                              {row._status === 'valid' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                              {row._status === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                              {row._status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                            </TableCell>
                            {mappedFields.map((f) => (
                              <TableCell key={f.key} className="max-w-[200px] truncate text-xs">
                                {String(row[f.key] ?? '')}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Errors & warnings detail */}
              {previewResult.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-600">Errors ({previewResult.errorRows})</p>
                  <div className="max-h-32 overflow-y-auto rounded border bg-red-50/50 p-2 dark:bg-red-950/20">
                    {previewResult.errors.slice(0, 20).map((e, i) => (
                      <p key={i} className="text-xs text-red-700 dark:text-red-300">
                        Row {e.row}: {e.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {previewResult.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-yellow-600">Warnings ({previewResult.warningRows})</p>
                  <div className="max-h-32 overflow-y-auto rounded border bg-yellow-50/50 p-2 dark:bg-yellow-950/20">
                    {previewResult.warnings.slice(0, 20).map((w, i) => (
                      <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300">
                        Row {w.row}: {w.field} — {w.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Execute / Result ───────────────────────── */}
          {step === 4 && (
            <div className="flex flex-col items-center justify-center py-12">
              {importing ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="mt-4 text-sm text-muted-foreground">Importing contacts...</p>
                </>
              ) : importResult ? (
                <div className="w-full max-w-md space-y-6">
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-12 w-12 text-green-500" />
                    <p className="text-lg font-medium">Import Complete</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <SummaryCard label="Created" value={importResult.created} color="text-green-600" />
                    <SummaryCard label="Updated" value={importResult.updated} color="text-blue-600" />
                    <SummaryCard label="Skipped" value={importResult.skipped} color="text-muted-foreground" />
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-red-600">{importResult.errors.length} error(s)</p>
                      <div className="max-h-32 overflow-y-auto rounded border bg-red-50/50 p-2 dark:bg-red-950/20">
                        {importResult.errors.slice(0, 20).map((e, i) => (
                          <p key={i} className="text-xs text-red-700 dark:text-red-300">
                            Row {e.row}: {e.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t pt-3">
          <div>
            {step > 0 && step < 4 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} disabled={previewing || importing}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 1 && (
              <Button size="sm" onClick={() => setStep(2)} disabled={!hasIdentifier}>
                Next
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" onClick={handlePreview} disabled={previewing}>
                {previewing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Preview
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
            {step === 3 && (
              <Button size="sm" onClick={handleImport} disabled={importing || (previewResult?.validRows ?? 0) + (previewResult?.warningRows ?? 0) === 0}>
                {importing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Import {((previewResult?.validRows ?? 0) + (previewResult?.warningRows ?? 0))} contacts
              </Button>
            )}
            {step === 4 && !importing && (
              <Button
                size="sm"
                onClick={() => {
                  onComplete();
                  handleOpenChange(false);
                }}
              >
                Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className={`text-2xl font-bold ${color || ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
