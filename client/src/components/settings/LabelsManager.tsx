import { useEffect, useState } from 'react';
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
import { Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

interface LabelItem {
  id: string;
  name: string;
  color: string;
}

const PRESET_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#6B7280', // gray
  '#78716C', // stone
];

export default function LabelsManager() {
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[5] });
  const [submitting, setSubmitting] = useState(false);

  const fetchLabels = async () => {
    try {
      const { data } = await api.get('/labels');
      setLabels(data.labels || []);
    } catch {
      toast.error('Failed to load labels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLabels();
  }, []);

  const resetForm = () => {
    setForm({ name: '', color: PRESET_COLORS[5] });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (label: LabelItem) => {
    setForm({ name: label.name, color: label.color });
    setEditingId(label.id);
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
        await api.put(`/labels/${editingId}`, form);
        toast.success('Label updated');
      } else {
        await api.post('/labels', form);
        toast.success('Label created');
      }
      setDialogOpen(false);
      resetForm();
      fetchLabels();
    } catch {
      toast.error('Failed to save label');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/labels/${id}`);
      toast.success('Label deleted');
      fetchLabels();
    } catch {
      toast.error('Failed to delete label');
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
          Organize and categorize conversations.
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="shrink-0" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Label' : 'New Label'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Urgent, VIP, Follow-up"
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

      {labels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Tag className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No labels yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create labels to organize your conversations.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          {labels.map((label, i) => (
            <div
              key={label.id}
              className={`group flex items-center gap-3 px-3 py-2.5 ${i !== labels.length - 1 ? 'border-b' : ''}`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="min-w-0 flex-1 text-sm">{label.name}</span>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => openEdit(label)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => handleDelete(label.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
