import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { ArrowUp, ArrowDown, Loader2, Pencil, Plus, Trash2, ListPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomFieldDefinition } from '@/hooks/useCustomFields';
import PermissionGate from '@/components/auth/PermissionGate';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';

interface CustomFieldsManagerProps {
  definitions: CustomFieldDefinition[];
  loading: boolean;
  onCreate: (def: { name: string; field_type: string; options?: string[]; is_required?: boolean }) => Promise<CustomFieldDefinition>;
  onUpdate: (defId: string, updates: Partial<CustomFieldDefinition>) => Promise<void>;
  onRemove: (defId: string) => Promise<void>;
  onReorder: (order: { id: string; display_order: number }[]) => Promise<void>;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  short_text: 'Short Text',
  long_text: 'Long Text',
  number: 'Number',
  dropdown: 'Dropdown',
  radio: 'Radio',
  multi_select: 'Multi-Select',
};

const TYPES_WITH_OPTIONS = ['dropdown', 'radio', 'multi_select'];

export default function CustomFieldsManager({
  definitions,
  loading,
  onCreate,
  onUpdate,
  onRemove,
  onReorder,
}: CustomFieldsManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    field_type: 'short_text',
    options: [] as string[],
    is_required: false,
  });
  const [originalForm, setOriginalForm] = useState({
    name: '',
    field_type: 'short_text',
    options: [] as string[],
    is_required: false,
  });
  const [optionInput, setOptionInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(form, dialogOpen ? originalForm : null);
  useFormDirtyGuard(isDirty);

  const resetForm = () => {
    setForm({ name: '', field_type: 'short_text', options: [], is_required: false });
    setOptionInput('');
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    const defaults = { name: '', field_type: 'short_text', options: [] as string[], is_required: false };
    setOriginalForm(defaults);
    setDialogOpen(true);
  };

  const openEdit = (def: CustomFieldDefinition) => {
    const values = {
      name: def.name,
      field_type: def.field_type,
      options: def.options || [],
      is_required: def.is_required,
    };
    setForm(values);
    setOriginalForm(values);
    setEditingId(def.id);
    setDialogOpen(true);
  };

  const addOption = () => {
    const val = optionInput.trim();
    if (val && !form.options.includes(val)) {
      setForm({ ...form, options: [...form.options, val] });
      setOptionInput('');
    }
  };

  const removeOption = (opt: string) => {
    setForm({ ...form, options: form.options.filter((o) => o !== opt) });
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (TYPES_WITH_OPTIONS.includes(form.field_type) && form.options.length === 0) {
      toast.error('At least one option is required');
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await onUpdate(editingId, form);
        toast.success('Field updated');
      } else {
        await onCreate(form);
        toast.success('Field created');
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error('Failed to save field');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onRemove(id);
      toast.success('Field removed');
    } catch {
      toast.error('Failed to remove field');
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= definitions.length) return;

    const newOrder = definitions.map((d, i) => ({
      id: d.id,
      display_order: i === index ? definitions[swapIndex].display_order
        : i === swapIndex ? definitions[index].display_order
        : d.display_order,
    }));

    try {
      await onReorder(newOrder);
    } catch {
      toast.error('Failed to reorder');
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
          Define custom fields for your contacts.
        </p>
        <PermissionGate resource="custom_fields" action="create">
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
                Add Field
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit Field' : 'New Custom Field'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Birthday, Lead Source"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select
                    value={form.field_type}
                    onValueChange={(val) => setForm({ ...form, field_type: val, options: TYPES_WITH_OPTIONS.includes(val) ? form.options : [] })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {TYPES_WITH_OPTIONS.includes(form.field_type) && (
                  <div>
                    <Label>Options</Label>
                    <div className="mt-1 space-y-2">
                      {form.options.map((opt) => (
                        <div key={opt} className="flex items-center gap-2">
                          <span className="flex-1 rounded border px-2 py-1 text-sm">{opt}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeOption(opt)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input
                          value={optionInput}
                          onChange={(e) => setOptionInput(e.target.value)}
                          placeholder="Add option..."
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                        />
                        <Button variant="outline" size="sm" onClick={addOption} disabled={!optionInput.trim()}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.is_required}
                    onCheckedChange={(checked) => setForm({ ...form, is_required: checked })}
                  />
                  <Label>Required</Label>
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

      {definitions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <ListPlus className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No custom fields</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add fields to capture additional contact information.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          {definitions.map((def, i) => (
            <div
              key={def.id}
              className={`group flex items-center gap-3 px-3 py-2.5 ${i !== definitions.length - 1 ? 'border-b' : ''}`}
            >
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground"
                  onClick={() => handleMove(i, 'up')}
                  disabled={i === 0}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground"
                  onClick={() => handleMove(i, 'down')}
                  disabled={i === definitions.length - 1}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm">{def.name}</span>
                {def.is_required && <span className="ml-1 text-xs text-destructive">*</span>}
              </div>
              <Badge variant="secondary" className="text-xs">
                {FIELD_TYPE_LABELS[def.field_type] || def.field_type}
              </Badge>
              <div className="flex shrink-0 gap-0.5">
                <PermissionGate resource="custom_fields" action="edit">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    onClick={() => openEdit(def)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </PermissionGate>
                <PermissionGate resource="custom_fields" action="delete">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => setPendingDeleteId(def.id)}
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
        title="Delete this field?"
        description="This field and its values will be removed from all contacts."
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
