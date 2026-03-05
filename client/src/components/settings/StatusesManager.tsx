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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CircleDot, GripVertical, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
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

interface StatusItem {
  id: string;
  name: string;
  color: string;
  group: 'open' | 'closed';
  sort_order: number;
  is_default: boolean;
}

const PRESET_COLORS = [
  '#22C55E', // green
  '#EAB308', // yellow
  '#F97316', // orange
  '#EF4444', // red
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#6B7280', // gray
  '#78716C', // stone
];

export default function StatusesManager() {
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[0], group: 'open' as 'open' | 'closed' });
  const [submitting, setSubmitting] = useState(false);

  const fetchStatuses = async () => {
    try {
      const { data } = await api.get('/conversation-statuses');
      setStatuses(data.statuses || []);
    } catch {
      toast.error('Failed to load statuses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
  }, []);

  const resetForm = () => {
    setForm({ name: '', color: PRESET_COLORS[0], group: 'open' });
    setEditingId(null);
  };

  const openCreate = (group: 'open' | 'closed') => {
    resetForm();
    setForm((prev) => ({ ...prev, group }));
    setDialogOpen(true);
  };

  const openEdit = (status: StatusItem) => {
    setForm({ name: status.name, color: status.color, group: status.group });
    setEditingId(status.id);
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
        await api.put(`/conversation-statuses/${editingId}`, form);
        toast.success('Status updated');
      } else {
        await api.post('/conversation-statuses', form);
        toast.success('Status created');
      }
      setDialogOpen(false);
      resetForm();
      fetchStatuses();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save status');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/conversation-statuses/${id}`);
      toast.success('Status deleted');
      fetchStatuses();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete status');
    }
  };

  const handleReorder = async (reordered: StatusItem[]) => {
    // Optimistic update
    setStatuses((prev) => {
      const otherGroup = prev.filter((s) => s.group !== reordered[0]?.group);
      return [...otherGroup, ...reordered].sort((a, b) => {
        if (a.group !== b.group) return a.group === 'open' ? -1 : 1;
        return a.sort_order - b.sort_order;
      });
    });

    try {
      await api.put('/conversation-statuses/reorder', {
        statuses: reordered.map((s, i) => ({ id: s.id, sort_order: i })),
      });
    } catch {
      toast.error('Failed to reorder statuses');
      fetchStatuses();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const openStatuses = statuses.filter((s) => s.group === 'open');
  const closedStatuses = statuses.filter((s) => s.group === 'closed');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define conversation statuses for your inbox.
      </p>

      {/* Open group */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => openCreate('open')}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
        <StatusGroup statuses={openStatuses} onEdit={openEdit} onDelete={handleDelete} onReorder={handleReorder} />
      </div>

      {/* Closed group */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closed</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => openCreate('closed')}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
        <StatusGroup statuses={closedStatuses} onEdit={openEdit} onDelete={handleDelete} onReorder={handleReorder} />
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Status' : 'New Status'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., In Progress, On Hold"
                className="mt-1"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <div>
              <Label>Group</Label>
              <Select
                value={form.group}
                onValueChange={(v) => setForm({ ...form, group: v as 'open' | 'closed' })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
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
    </div>
  );
}

function StatusGroup({
  statuses,
  onEdit,
  onDelete,
  onReorder,
}: {
  statuses: StatusItem[];
  onEdit: (s: StatusItem) => void;
  onDelete: (id: string) => void;
  onReorder: (reordered: StatusItem[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = statuses.findIndex((s) => s.id === active.id);
    const newIndex = statuses.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(statuses, oldIndex, newIndex).map((s, i) => ({
      ...s,
      sort_order: i,
    }));
    onReorder(reordered);
  };

  if (statuses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-4 text-center">
        <p className="text-xs text-muted-foreground">No statuses</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-lg border">
          {statuses.map((status, i) => (
            <SortableStatusRow
              key={status.id}
              status={status}
              isLast={i === statuses.length - 1}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableStatusRow({
  status,
  isLast,
  onEdit,
  onDelete,
}: {
  status: StatusItem;
  isLast: boolean;
  onEdit: (s: StatusItem) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: status.id });

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
      <CircleDot className="h-3.5 w-3.5 shrink-0" style={{ color: status.color }} />
      <span className="min-w-0 flex-1 text-sm">{status.name}</span>
      {status.is_default && (
        <span className="text-[10px] text-muted-foreground">Default</span>
      )}
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={() => onEdit(status)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {!status.is_default && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={() => onDelete(status.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
