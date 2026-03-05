import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface UnsavedChangesDialogProps {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
}

export function UnsavedChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
  onSave,
  saving,
}: UnsavedChangesDialogProps) {
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  // Focus the "Keep Editing" button when dialog opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => keepEditingRef.current?.focus());
    }
  }, [open]);

  // Handle Escape key (capture phase to intercept before Radix)
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onKeepEditing();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onKeepEditing]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="alertdialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Overlay */}
      <div
        className="animate-in fade-in-0 fixed inset-0 bg-black/50"
        onClick={onKeepEditing}
      />
      {/* Content */}
      <div className="animate-in fade-in-0 zoom-in-95 relative w-full max-w-[calc(100%-2rem)] rounded-lg border bg-background p-6 shadow-lg sm:max-w-lg">
        <h2 className="text-lg font-semibold">Unsaved changes</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You have unsaved changes. What would you like to do?
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" ref={keepEditingRef} onClick={onKeepEditing}>
            Keep Editing
          </Button>
          <Button
            variant="destructive"
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
