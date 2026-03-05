import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, List, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ContactList } from '@/hooks/useContactLists';
import PermissionGate from '@/components/auth/PermissionGate';

interface ContactListsManagerProps {
  lists: ContactList[];
  loading: boolean;
  onCreateList: (name: string, description?: string, color?: string) => Promise<ContactList>;
  onUpdateList: (listId: string, updates: { name?: string; description?: string; color?: string }) => Promise<void>;
  onDeleteList: (listId: string) => Promise<void>;
}

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280', '#78716C',
];

export default function ContactListsManager({
  lists,
  loading,
  onCreateList,
  onUpdateList,
  onDeleteList,
}: ContactListsManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', color: PRESET_COLORS[5] });
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setForm({ name: '', description: '', color: PRESET_COLORS[5] });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (list: ContactList) => {
    setForm({ name: list.name, description: list.description || '', color: list.color });
    setEditingId(list.id);
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
        await onUpdateList(editingId, {
          name: form.name,
          description: form.description || undefined,
          color: form.color,
        });
        toast.success('List updated');
      } else {
        await onCreateList(form.name, form.description || undefined, form.color);
        toast.success('List created');
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error('Failed to save list');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onDeleteList(id);
      toast.success('List deleted');
    } catch {
      toast.error('Failed to delete list');
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
          Create lists to group your contacts.
        </p>
        <PermissionGate resource="contact_lists" action="create">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="shrink-0" onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit List' : 'New List'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., VIP Customers, Newsletter"
                    className="mt-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="A short description of this list..."
                    className="mt-1"
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
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
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

      {lists.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <List className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No lists yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create lists to group your contacts.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          {lists.map((list, i) => (
            <div
              key={list.id}
              className={`group flex items-center gap-3 px-3 py-2.5 ${i !== lists.length - 1 ? 'border-b' : ''}`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: list.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{list.name}</span>
                  {list.member_count != null && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {list.member_count}
                    </Badge>
                  )}
                </div>
                {list.description && (
                  <p className="truncate text-xs text-muted-foreground">{list.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <PermissionGate resource="contact_lists" action="edit">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={() => openEdit(list)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
                <PermissionGate resource="contact_lists" action="delete">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => handleDelete(list.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
