import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import type { Contact } from '@/hooks/useContacts';

interface MergeContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactA: Contact;
  contactB: Contact;
  onMergeComplete: () => void;
}

type FieldChoice = 'a' | 'b' | 'custom';

interface FieldResolution {
  choice: FieldChoice;
  customValue?: string;
}

const MERGE_FIELDS = [
  { key: 'phone_number', label: 'Phone' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'notes', label: 'Notes' },
  { key: 'address_street', label: 'Street' },
  { key: 'address_city', label: 'City' },
  { key: 'address_state', label: 'State' },
  { key: 'address_postal_code', label: 'Postal Code' },
  { key: 'address_country', label: 'Country' },
] as const;

type MergeFieldKey = (typeof MERGE_FIELDS)[number]['key'];

export default function MergeContactDialog({
  open,
  onOpenChange,
  contactA,
  contactB,
  onMergeComplete,
}: MergeContactDialogProps) {
  const [resolutions, setResolutions] = useState<Record<string, FieldResolution>>(() => {
    // Default: prefer contactA's values, fallback to contactB
    const init: Record<string, FieldResolution> = {};
    for (const { key } of MERGE_FIELDS) {
      const aVal = contactA[key as keyof Contact];
      const bVal = contactB[key as keyof Contact];
      init[key] = { choice: aVal ? 'a' : bVal ? 'b' : 'a' };
    }
    return init;
  });
  const [merging, setMerging] = useState(false);

  const nameA = [contactA.first_name, contactA.last_name].filter(Boolean).join(' ')
    || contactA.phone_number;
  const nameB = [contactB.first_name, contactB.last_name].filter(Boolean).join(' ')
    || contactB.phone_number;

  const setFieldChoice = (key: string, choice: FieldChoice) => {
    setResolutions((prev) => ({ ...prev, [key]: { ...prev[key], choice } }));
  };

  const setCustomValue = (key: string, value: string) => {
    setResolutions((prev) => ({
      ...prev,
      [key]: { choice: 'custom', customValue: value },
    }));
  };

  const getResolvedValue = (key: MergeFieldKey): unknown => {
    const res = resolutions[key];
    if (res.choice === 'custom') return res.customValue || null;
    if (res.choice === 'a') return contactA[key as keyof Contact];
    return contactB[key as keyof Contact];
  };

  const handleMerge = async () => {
    setMerging(true);
    try {
      const resolvedFields: Record<string, unknown> = {};
      for (const { key } of MERGE_FIELDS) {
        resolvedFields[key] = getResolvedValue(key);
      }

      await api.post('/contacts/merge', {
        keepContactId: contactA.id,
        mergeContactId: contactB.id,
        resolvedFields,
      });

      toast.success('Contacts merged successfully');
      onMergeComplete();
      onOpenChange(false);
    } catch {
      toast.error('Failed to merge contacts');
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Merge Contacts
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {/* Column headers */}
          <div className="sticky top-0 z-10 grid grid-cols-[140px_1fr_1fr] gap-2 border-b bg-background px-1 pb-2 text-xs font-medium text-muted-foreground">
            <div>Field</div>
            <div className="truncate">{nameA}</div>
            <div className="truncate">{nameB}</div>
          </div>

          <div className="mt-2 space-y-1">
            {MERGE_FIELDS.map(({ key, label }) => {
              const aVal = String(contactA[key as keyof Contact] ?? '');
              const bVal = String(contactB[key as keyof Contact] ?? '');
              const res = resolutions[key];
              const isDifferent = aVal !== bVal;

              return (
                <div
                  key={key}
                  className={cn(
                    'grid grid-cols-[140px_1fr_1fr] gap-2 rounded px-1 py-1.5',
                    isDifferent && 'bg-muted/50'
                  )}
                >
                  <div className="flex items-center text-xs font-medium text-muted-foreground">
                    {label}
                    {isDifferent && (
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    )}
                  </div>
                  <button
                    className={cn(
                      'rounded border px-2 py-1 text-left text-xs transition-colors',
                      res.choice === 'a'
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-transparent hover:border-muted-foreground/30'
                    )}
                    onClick={() => setFieldChoice(key, 'a')}
                  >
                    {aVal || <span className="text-muted-foreground italic">empty</span>}
                  </button>
                  <button
                    className={cn(
                      'rounded border px-2 py-1 text-left text-xs transition-colors',
                      res.choice === 'b'
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-transparent hover:border-muted-foreground/30'
                    )}
                    onClick={() => setFieldChoice(key, 'b')}
                  >
                    {bVal || <span className="text-muted-foreground italic">empty</span>}
                  </button>
                  {res.choice === 'custom' && (
                    <div className="col-span-2 col-start-2 mt-1">
                      <Input
                        className="h-7 text-xs"
                        value={res.customValue || ''}
                        onChange={(e) => setCustomValue(key, e.target.value)}
                        placeholder="Custom value..."
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tags — merged automatically */}
            <div className="grid grid-cols-[140px_1fr_1fr] gap-2 rounded px-1 py-1.5">
              <div className="flex items-center text-xs font-medium text-muted-foreground">
                Tags
              </div>
              <div className="col-span-2 flex flex-wrap gap-1">
                {[...new Set([...(contactA.tags || []), ...(contactB.tags || [])])].map(
                  (tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  )
                )}
                <span className="self-center text-[10px] text-muted-foreground">
                  (combined automatically)
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <p className="mr-auto text-xs text-muted-foreground">
            &ldquo;{nameB}&rdquo; will be merged into &ldquo;{nameA}&rdquo; and deleted.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={merging}>
            {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
