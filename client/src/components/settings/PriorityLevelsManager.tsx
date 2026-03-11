import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { Flag, GripVertical, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useConversationPriorities, type ConversationPriority } from '@/hooks/useConversationPriorities';

const PRESET_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280'];

export default function PriorityLevelsManager() {
  const { priorities, loading, create, update, reorder, remove, refetch } = useConversationPriorities();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[0] });
  const [originalForm, setOriginalForm] = useState({ name: '', color: PRESET_COLORS[0] });
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(
    form,
    dialogOpen ? originalForm : null,
  );
  useFormDirtyGuard(isDirty);

  useEffect(() => {
    if (!dialogOpen) {
      setForm({ name: '', color: PRESET_COLORS[0] });
      setEditingId(null);
    }
  }, [dialogOpen]);

  const openCreate = () => {
    const defaults = { name: '', color: PRESET_COLORS[0] };
    setForm(defaults);
    setOriginalForm(defaults);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (priority: ConversationPriority) => {
    const values = { name: priority.name, color: priority.color };
    setForm(values);
    setOriginalForm(values);
    setEditingId(priority.id);
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
        await update(editingId, form);
        toast.success('Priority updated');
      } else {
        await create(form);
        toast.success('Priority created');
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save priority');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      toast.success('Priority deleted');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete priority');
    }
  };

  const handleReorder = async (reordered: ConversationPriority[]) => {
    try {
      await reorder(reordered.map((priority, index) => ({ id: priority.id, sort_order: index })));
    } catch {
      toast.error('Failed to reorder priorities');
      refetch();
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
          Add and edit the priority levels available in the inbox.
        </p>
        <Button size="sm" className="shrink-0" onClick={openCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {priorities.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Flag className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No priorities yet</p>
        </div>
      ) : (
        <PriorityList priorities={priorities} onEdit={openEdit} onDelete={setPendingDeleteId} onReorder={handleReorder} />
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            guardedClose(() => setDialogOpen(false));
          } else {
            setDialogOpen(true);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Priority' : 'New Priority'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Escalated"
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
              <Button variant="outline" onClick={() => guardedClose(() => setDialogOpen(false))}>
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

      <ConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title="Delete this priority?"
        description="Conversations using it will be moved back to None."
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

function PriorityList({
  priorities,
  onEdit,
  onDelete,
  onReorder,
}: {
  priorities: ConversationPriority[];
  onEdit: (priority: ConversationPriority) => void;
  onDelete: (id: string) => void;
  onReorder: (priorities: ConversationPriority[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = priorities.findIndex((priority) => priority.id === active.id);
    const newIndex = priorities.findIndex((priority) => priority.id === over.id);
    onReorder(arrayMove(priorities, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={priorities.map((priority) => priority.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-lg border">
          {priorities.map((priority, index) => (
            <SortablePriorityRow
              key={priority.id}
              priority={priority}
              isLast={index === priorities.length - 1}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortablePriorityRow({
  priority,
  isLast,
  onEdit,
  onDelete,
}: {
  priority: ConversationPriority;
  isLast: boolean;
  onEdit: (priority: ConversationPriority) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: priority.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-2 py-2.5 ${!isLast ? 'border-b' : ''} ${isDragging ? 'rounded-lg border bg-background shadow-md' : ''}`}
    >
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: priority.color }} />
      <span className="min-w-0 flex-1 text-sm">{priority.name}</span>
      {priority.is_default && <span className="text-[10px] text-muted-foreground">Default</span>}
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={() => onEdit(priority)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {!priority.is_default && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={() => onDelete(priority.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
