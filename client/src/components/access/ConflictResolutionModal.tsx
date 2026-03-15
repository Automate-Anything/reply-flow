// client/src/components/access/ConflictResolutionModal.tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { PermissionConflict, ConflictResolution } from '@/hooks/usePermissions';

interface ConflictResolutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: PermissionConflict[];
  onResolve: (resolutions: ConflictResolution[]) => Promise<void>;
}

export default function ConflictResolutionModal({
  open,
  onOpenChange,
  conflicts,
  onResolve,
}: ConflictResolutionModalProps) {
  const [resolutions, setResolutions] = useState<Map<string, 'keep' | 'remove'>>(new Map());
  const [showIndividual, setShowIndividual] = useState(conflicts.length <= 3);
  const [saving, setSaving] = useState(false);

  const totalPeople = conflicts.length;
  const totalConversations = conflicts.reduce((sum, c) => sum + c.sessionIds.length, 0);
  const keepAllNames = conflicts.map((c) => c.userName).slice(0, 3);
  const keepAllExtra = conflicts.length - 3;

  const getResolution = (userId: string): 'keep' | 'remove' => {
    return resolutions.get(userId) || 'keep'; // Default to keep (suggested)
  };

  const setResolutionFor = (userId: string, action: 'keep' | 'remove') => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(userId, action);
      return next;
    });
  };

  const handleApplySuggested = async () => {
    // Apply "keep" for all
    const allKeep: ConflictResolution[] = conflicts.map((c) => ({
      userId: c.userId,
      action: 'keep',
    }));
    setSaving(true);
    try {
      await onResolve(allKeep);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const resolved: ConflictResolution[] = conflicts.map((c) => ({
      userId: c.userId,
      action: getResolution(c.userId),
    }));
    setSaving(true);
    try {
      await onResolve(resolved);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Review access changes
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!showIndividual ? (
            // Bulk view
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {totalConversations} conversation{totalConversations > 1 ? 's' : ''} have custom
                access for {totalPeople} {totalPeople > 1 ? 'people' : 'person'} losing channel access.
              </p>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-sm font-medium">
                  Suggested: Keep all access
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Adds {keepAllNames.join(', ')}
                  {keepAllExtra > 0 ? ` and ${keepAllExtra} other${keepAllExtra > 1 ? 's' : ''}` : ''} to
                  channel with View
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleApplySuggested} disabled={saving} className="flex-1">
                  Apply suggested
                </Button>
                <Button variant="outline" onClick={() => setShowIndividual(true)} className="flex-1">
                  Review individually
                </Button>
              </div>
            </div>
          ) : (
            // Individual view
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {conflicts.map((conflict) => (
                <div key={conflict.userId} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{conflict.userName}</span>
                    <span className="text-xs text-muted-foreground">
                      {conflict.sessionIds.length} conversation{conflict.sessionIds.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`resolve-${conflict.userId}`}
                        checked={getResolution(conflict.userId) === 'keep'}
                        onChange={() => setResolutionFor(conflict.userId, 'keep')}
                        className="accent-primary"
                      />
                      <span>Keep access</span>
                      <span className="text-xs text-muted-foreground">
                        — add to channel with View
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`resolve-${conflict.userId}`}
                        checked={getResolution(conflict.userId) === 'remove'}
                        onChange={() => setResolutionFor(conflict.userId, 'remove')}
                        className="accent-primary"
                      />
                      <span>Remove access</span>
                      <span className="text-xs text-muted-foreground">
                        — {conflict.userName} loses access
                      </span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showIndividual && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>Save changes</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
