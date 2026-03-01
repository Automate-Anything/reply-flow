import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { FileText, BookOpen, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChannelAgent } from '@/hooks/useChannelAgent';
import type { KBAttachment } from '@/hooks/useCompanyAI';
import type { KBEntry } from '@/hooks/useCompanyKB';
import KBPicker from './KBPicker';

interface Props {
  channelId: number;
  kbEntries: KBEntry[];
  loadingKB: boolean;
}

export default function KBAssignmentList({ channelId, kbEntries, loadingKB }: Props) {
  const kbLink = `/knowledge-base?from=channel&channelId=${channelId}&action=add`;

  const {
    assignments,
    loadingAssignments,
    updateAssignments,
  } = useChannelAgent(channelId);

  const [localAssignments, setLocalAssignments] = useState<KBAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalAssignments(assignments);
  }, [assignments]);

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
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          No knowledge base entries yet
        </p>
        <Button size="sm" variant="outline" className="mt-1" asChild>
          <Link to={kbLink}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Knowledge Base Entry
          </Link>
        </Button>
      </div>
    );
  }

  const handleChange = async (next: KBAttachment[]) => {
    const prev = localAssignments;
    setLocalAssignments(next);
    setSaving(true);
    try {
      await updateAssignments(next);
    } catch {
      setLocalAssignments(prev);
      toast.error('Failed to update assignment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BookOpen className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">Knowledge Base</p>
          <p className="text-xs text-muted-foreground">
            {localAssignments.length === 0
              ? 'No entries assigned — AI will use all company entries'
              : `${localAssignments.length} of ${kbEntries.length} entries assigned`}
          </p>
        </div>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Button size="sm" variant="outline" asChild>
          <Link to={kbLink}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New
          </Link>
        </Button>
      </div>

      <KBPicker
        value={localAssignments}
        onChange={handleChange}
        kbEntries={kbEntries}
        createEntryHref={kbLink}
        disabled={saving}
      />
    </div>
  );
}
