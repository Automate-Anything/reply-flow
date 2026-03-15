import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import api from '@/lib/api';

interface Holiday {
  id: string;
  company_id: string;
  user_id: string | null;
  scope: 'company' | 'user';
  name: string;
  date: string;
  recurring: boolean;
  created_at: string;
}

interface HolidayEditorProps {
  scope: 'company' | 'user';
  canEdit?: boolean;
}

interface HolidayFormState {
  name: string;
  date: string;
  recurring: boolean;
}

const EMPTY_FORM: HolidayFormState = { name: '', date: '', recurring: false };

function formatDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"; parse as local date to avoid timezone offset issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HolidayEditor({ scope, canEdit = true }: HolidayEditorProps) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<HolidayFormState>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<HolidayFormState>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ holidays: Holiday[] }>('/holidays', { params: { scope } })
      .then(({ data }) => {
        if (!cancelled) setHolidays(data.holidays);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load holidays.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scope]);

  const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

  const handleAdd = async () => {
    if (!addForm.name.trim() || !addForm.date) {
      toast.error('Please enter a name and date.');
      return;
    }
    setAddSaving(true);
    try {
      const { data } = await api.post<{ holiday: Holiday }>('/holidays', {
        name: addForm.name.trim(),
        date: addForm.date,
        recurring: addForm.recurring,
        scope,
      });
      setHolidays((prev) => [...prev, data.holiday]);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      toast.success('Holiday added.');
    } catch {
      toast.error('Failed to add holiday.');
    } finally {
      setAddSaving(false);
    }
  };

  const handleEditStart = (holiday: Holiday) => {
    setEditingId(holiday.id);
    setEditForm({ name: holiday.name, date: holiday.date, recurring: holiday.recurring });
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    if (!editForm.name.trim() || !editForm.date) {
      toast.error('Please enter a name and date.');
      return;
    }
    setEditSaving(true);
    try {
      const { data } = await api.put<{ holiday: Holiday }>(`/holidays/${editingId}`, {
        name: editForm.name.trim(),
        date: editForm.date,
        recurring: editForm.recurring,
      });
      setHolidays((prev) => prev.map((h) => (h.id === editingId ? data.holiday : h)));
      setEditingId(null);
      toast.success('Holiday updated.');
    } catch {
      toast.error('Failed to update holiday.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this holiday?')) return;
    try {
      await api.delete(`/holidays/${id}`);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      toast.success('Holiday deleted.');
    } catch {
      toast.error('Failed to delete holiday.');
    }
  };

  const title = scope === 'company' ? 'Company Holidays' : 'Personal Days Off';
  const description =
    scope === 'company'
      ? 'These holidays apply to all AI activity schedules using business hours.'
      : "You'll be set as Away on these days.";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">{description}</CardDescription>
          </div>
          {canEdit && !showAddForm && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Holiday
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Add form */}
        {showAddForm && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-holiday-name" className="text-xs">Name</Label>
                <Input
                  id="add-holiday-name"
                  placeholder="e.g. Christmas Day"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-holiday-date" className="text-xs">Date</Label>
                <Input
                  id="add-holiday-date"
                  type="date"
                  value={addForm.date}
                  onChange={(e) => setAddForm((f) => ({ ...f, date: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={addForm.recurring}
                onCheckedChange={(checked) => setAddForm((f) => ({ ...f, recurring: !!checked }))}
              />
              <span className="text-sm">Repeats every year</span>
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={addSaving}>
                {addSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
                disabled={addSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Holiday list */}
        {loading ? (
          <p className="text-sm text-muted-foreground py-2">Loading...</p>
        ) : sortedHolidays.length === 0 && !showAddForm ? (
          <p className="text-sm text-muted-foreground py-2">No holidays added yet.</p>
        ) : (
          <div className="space-y-1">
            {sortedHolidays.map((holiday) =>
              editingId === holiday.id ? (
                /* Inline edit form */
                <div key={holiday.id} className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-name-${holiday.id}`} className="text-xs">Name</Label>
                      <Input
                        id={`edit-name-${holiday.id}`}
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-date-${holiday.id}`} className="text-xs">Date</Label>
                      <Input
                        id={`edit-date-${holiday.id}`}
                        type="date"
                        value={editForm.date}
                        onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={editForm.recurring}
                      onCheckedChange={(checked) => setEditForm((f) => ({ ...f, recurring: !!checked }))}
                    />
                    <span className="text-sm">Repeats every year</span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleEditSave} disabled={editSaving}>
                      {editSaving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleEditCancel}
                      disabled={editSaving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                /* Holiday row */
                <div
                  key={holiday.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <span className="w-28 shrink-0 text-sm text-muted-foreground">
                    {formatDate(holiday.date)}
                  </span>
                  <span className="flex-1 text-sm font-medium">{holiday.name}</span>
                  {holiday.recurring && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Repeats yearly
                    </Badge>
                  )}
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditStart(holiday)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(holiday.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
