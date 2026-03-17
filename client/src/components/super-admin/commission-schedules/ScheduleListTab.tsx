import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Layers, Plus, Pencil, Trash2 } from 'lucide-react';
import { ScheduleEditorDialog } from './ScheduleEditorDialog';
import { SchedulePreview } from './SchedulePreview';

export interface SchedulePeriod {
  id?: string;
  from_payment: number;
  to_payment: number;
  rate: number;
}

export interface Schedule {
  id: string;
  name: string;
  commission_type: string;
  end_behavior: string;
  end_rate: number | null;
  created_at: string;
  periods: SchedulePeriod[];
}

export function ScheduleListTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [previewSchedule, setPreviewSchedule] = useState<Schedule | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ schedules: Schedule[] }>('/affiliate/admin/schedules');
      setSchedules(data.schedules);
    } catch {
      toast.error('Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await api.delete(`/affiliate/admin/schedules/${id}`);
      toast.success('Schedule deleted');
      fetchSchedules();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete schedule');
    }
  };

  const handleEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingSchedule(null);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Commission Schedules</h2>
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" /> New Schedule
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No schedules created yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Periods</TableHead>
                <TableHead>End Behavior</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell className="font-medium">
                    <button
                      className="text-left hover:underline text-primary"
                      onClick={() => setPreviewSchedule(previewSchedule?.id === schedule.id ? null : schedule)}
                    >
                      {schedule.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{schedule.commission_type}</Badge>
                  </TableCell>
                  <TableCell>{schedule.periods.length}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{schedule.end_behavior.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(schedule.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(schedule)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(schedule.id)} title="Delete">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {previewSchedule && (
        <SchedulePreview schedule={previewSchedule} />
      )}

      <ScheduleEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditingSchedule(null);
        }}
        schedule={editingSchedule}
        onSaved={fetchSchedules}
      />
    </div>
  );
}
