import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useCannedResponses, type CannedResponse } from '@/hooks/useCannedResponses';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';

export default function CannedResponsesManager() {
  const { responses, loading, create, update, remove } = useCannedResponses();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', shortcut: '', category: '' });
  const [originalForm, setOriginalForm] = useState({ title: '', content: '', shortcut: '', category: '' });
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(form, dialogOpen ? originalForm : null);
  useFormDirtyGuard(isDirty);

  const resetForm = () => {
    setForm({ title: '', content: '', shortcut: '', category: '' });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    const defaults = { title: '', content: '', shortcut: '', category: '' };
    setOriginalForm(defaults);
    setDialogOpen(true);
  };

  const openEdit = (response: CannedResponse) => {
    const values = {
      title: response.title,
      content: response.content,
      shortcut: response.shortcut || '',
      category: response.category || '',
    };
    setForm(values);
    setOriginalForm(values);
    setEditingId(response.id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await update(editingId, form);
        toast.success('Quick reply updated');
      } else {
        await create(form);
        toast.success('Quick reply created');
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error('Failed to save quick reply');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      toast.success('Quick reply deleted');
    } catch {
      toast.error('Failed to delete quick reply');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Type "/" in the message input to use quick replies.
        </p>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
              if (!open) {
                guardedClose(() => { setDialogOpen(false); resetForm(); });
              } else {
                setDialogOpen(true);
              }
            }}>
          <DialogTrigger asChild>
            <Button size="sm" className="shrink-0" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </DialogTrigger>
            <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Quick Reply' : 'New Quick Reply'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Greeting"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Content</Label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="The message text that will be inserted..."
                  rows={4}
                  className="mt-1 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Shortcut (optional)</Label>
                  <Input
                    value={form.shortcut}
                    onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                    placeholder="e.g., greet"
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Type /greet to find this quickly
                  </p>
                </div>
                <div>
                  <Label>Category (optional)</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="e.g., Sales"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => guardedClose(() => { setDialogOpen(false); resetForm(); })}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingId ? 'Save Changes' : 'Create'}
                </Button>
              </div>
            </div>
            </DialogContent>
        </Dialog>
      </div>

      {responses.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Zap className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No quick replies yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create templates for common messages you send frequently.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          {responses.map((response, i) => (
            <div
              key={response.id}
              className={`group flex items-start gap-3 px-3 py-2.5 ${i !== responses.length - 1 ? 'border-b' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{response.title}</h4>
                  {response.shortcut && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      /{response.shortcut}
                    </span>
                  )}
                  {response.category && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      {response.category}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {response.content}
                </p>
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => openEdit(response)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => setPendingDeleteId(response.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title="Delete this quick reply?"
        description="This action cannot be undone."
        onConfirm={() => {
          handleDelete(pendingDeleteId!);
          setPendingDeleteId(null);
        }}
      />

      <UnsavedChangesDialog
        open={showDialog}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscard}
        onSave={handleSubmit}
        saving={submitting}
      />
    </div>
  );
}
