import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useGroupCriteria } from '@/hooks/useGroupCriteria';
import { CriteriaCard } from './CriteriaCard';
import { CriteriaDialog } from './CriteriaDialog';
import type { GroupCriteria } from '@/types/groups';
import { Loader2 } from 'lucide-react';

export function GlobalCriteriaList() {
  const { criteria, loading, createCriteria, updateCriteria, deleteCriteria } =
    useGroupCriteria(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupCriteria | null>(null);

  const handleSave = async (values: Partial<GroupCriteria>) => {
    if (editing) {
      await updateCriteria(editing.id, values);
    } else {
      await createCriteria(values);
    }
    setEditing(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium">Global Criteria</h2>
          <p className="text-sm text-muted-foreground">
            These criteria apply across all monitored groups.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Criteria
        </Button>
      </div>

      {criteria.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No global criteria configured yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {criteria.map((c) => (
            <CriteriaCard
              key={c.id}
              criteria={c}
              onEdit={() => { setEditing(c); setDialogOpen(true); }}
              onDelete={() => deleteCriteria(c.id)}
              onToggle={(enabled) => updateCriteria(c.id, { is_enabled: enabled })}
            />
          ))}
        </div>
      )}

      <CriteriaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        criteria={editing}
        onSave={handleSave}
      />
    </div>
  );
}
