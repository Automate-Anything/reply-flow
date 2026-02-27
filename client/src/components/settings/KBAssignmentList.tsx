import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useChannelAgent } from '@/hooks/useChannelAgent';
import type { KBEntry } from '@/hooks/useCompanyKB';

interface Props {
  channelId: number;
  kbEntries: KBEntry[];
  loadingKB: boolean;
}

export default function KBAssignmentList({ channelId, kbEntries, loadingKB }: Props) {
  const {
    assignedEntryIds,
    loadingAssignments,
    updateAssignments,
  } = useChannelAgent(channelId);

  const [localAssigned, setLocalAssigned] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync local state when assignments load
  useEffect(() => {
    setLocalAssigned(new Set(assignedEntryIds));
    setDirty(false);
  }, [assignedEntryIds]);

  if (loadingKB || loadingAssignments) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (kbEntries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <FileText className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No knowledge base entries yet.
        </p>
        <p className="text-xs text-muted-foreground">
          Add entries on the Knowledge Base page first.
        </p>
      </div>
    );
  }

  const handleToggle = (entryId: string, checked: boolean) => {
    setLocalAssigned((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAssignments(Array.from(localAssigned));
      setDirty(false);
      toast.success('KB assignments updated');
    } catch {
      toast.error('Failed to update assignments');
    } finally {
      setSaving(false);
    }
  };

  const noneSelected = kbEntries.every((e) => !localAssigned.has(e.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Knowledge Base Assignments</p>
          <p className="text-xs text-muted-foreground">
            {noneSelected
              ? 'No entries assigned — AI will use all company entries.'
              : `${localAssigned.size} of ${kbEntries.length} entries assigned`}
          </p>
        </div>
        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        )}
      </div>

      <div className="space-y-1">
        {kbEntries.map((entry) => (
          <label
            key={entry.id}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 cursor-pointer hover:bg-accent transition-colors"
          >
            <Checkbox
              checked={localAssigned.has(entry.id)}
              onCheckedChange={(checked) => handleToggle(entry.id, !!checked)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{entry.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {entry.content.slice(0, 80)}{entry.content.length > 80 ? '...' : ''}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {entry.source_type === 'file' ? entry.file_name?.split('.').pop()?.toUpperCase() || 'FILE' : 'TEXT'}
            </Badge>
          </label>
        ))}
      </div>
    </div>
  );
}
