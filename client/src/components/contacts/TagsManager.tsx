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
import { Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ContactTag } from '@/hooks/useContactTags';
import PermissionGate from '@/components/auth/PermissionGate';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';

interface TagsManagerProps {
  tags: ContactTag[];
  loading: boolean;
  onCreateTag: (name: string, color?: string) => Promise<ContactTag>;
  onUpdateTag: (tagId: string, updates: { name?: string; color?: string }) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
}

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280', '#78716C',
];

export default function TagsManager({ tags, loading, onCreateTag, onUpdateTag, onDeleteTag }: TagsManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[5] });
  const [originalForm, setOriginalForm] = useState({ name: '', color: PRESET_COLORS[5] });
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(form, dialogOpen ? originalForm : null);
  useFormDirtyGuard(isDirty);

  const resetForm = () => {
    setForm({ name: '', color: PRESET_COLORS[5] });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    const defaults = { name: '', color: PRESET_COLORS[5] };
    setOriginalForm(defaults);
    setDialogOpen(true);
  };

  const openEdit = (tag: ContactTag) => {
    const values = { name: tag.name, color: tag.color };
    setForm(values);
    setOriginalForm(values);
    setEditingId(tag.id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await onUpdateTag(editingId, form);
        toast.success('Tag updated');
      } else {
        await onCreateTag(form.name, form.color);
        toast.success('Tag created');
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error('Failed to save tag');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onDeleteTag(id);
      toast.success('Tag deleted');
    } catch {
      toast.error('Failed to delete tag');
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
          Define tags to organize your contacts.
        </p>
        <PermissionGate resource="contact_tags" action="create">
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
                <DialogTitle>{editingId ? 'Edit Tag' : 'New Tag'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., VIP, Lead, Follow-up"
                    className="mt-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
                <div>
                  <Label>Color</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: color,
                          borderColor: form.color === color ? 'white' : 'transparent',
                          boxShadow: form.color === color ? `0 0 0 2px ${color}` : 'none',
                        }}
                        onClick={() => setForm({ ...form, color })}
                      />
                    ))}
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
        </PermissionGate>
      </div>

      {tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Tag className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No tags yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create tags to organize your contacts.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          {tags.map((tag, i) => (
            <div
              key={tag.id}
              className={`group flex items-center gap-3 px-3 py-2.5 ${i !== tags.length - 1 ? 'border-b' : ''}`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="min-w-0 flex-1 text-sm">{tag.name}</span>
              <div className="flex shrink-0 gap-0.5">
                <PermissionGate resource="contact_tags" action="edit">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={() => openEdit(tag)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
                <PermissionGate resource="contact_tags" action="delete">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => setPendingDeleteId(tag.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title="Delete this tag?"
        description="The tag will be removed from all contacts."
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
