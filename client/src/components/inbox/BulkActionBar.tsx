import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Archive, Flag, Loader2, Star, Tag, UserPlus, CircleDot, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { TeamMember } from '@/hooks/useTeamMembers';

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

interface BulkActionBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onActionComplete: () => void;
  teamMembers: TeamMember[];
  labels: LabelOption[];
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', color: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'bg-blue-500' },
  { value: 'none', label: 'None', color: 'bg-gray-300' },
];

export default function BulkActionBar({
  selectedIds,
  onClearSelection,
  onActionComplete,
  teamMembers,
  labels,
}: BulkActionBarProps) {
  const [loading, setLoading] = useState(false);

  const executeBulk = async (action: string, value: unknown) => {
    setLoading(true);
    try {
      await api.post('/conversations/bulk', { sessionIds: selectedIds, action, value });
      onActionComplete();
      onClearSelection();
      toast.success(`Updated ${selectedIds.length} conversations`);
    } catch {
      toast.error('Bulk action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1 border-t bg-background px-3 py-2">
      <span className="mr-1 text-xs font-medium text-muted-foreground">
        {selectedIds.length} selected
      </span>

      {/* Assign */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="Assign">
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => executeBulk('assign', null)}>
            Unassign
          </DropdownMenuItem>
          {teamMembers.map((m) => (
            <DropdownMenuItem key={m.user_id} onClick={() => executeBulk('assign', m.user_id)}>
              {m.full_name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="Status">
            <CircleDot className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUS_OPTIONS.map((s) => (
            <DropdownMenuItem key={s.value} onClick={() => executeBulk('status', s.value)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Priority */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="Priority">
            <Flag className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRIORITY_OPTIONS.map((p) => (
            <DropdownMenuItem key={p.value} onClick={() => executeBulk('priority', p.value)}>
              <span className={`mr-2 h-2 w-2 rounded-full ${p.color}`} />
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Label */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="Label">
            <Tag className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add label</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {labels.map((l) => (
                <DropdownMenuItem key={l.id} onClick={() => executeBulk('label_add', l.id)}>
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.name}
                </DropdownMenuItem>
              ))}
              {labels.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No labels</div>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Remove label</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {labels.map((l) => (
                <DropdownMenuItem key={l.id} onClick={() => executeBulk('label_remove', l.id)}>
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.name}
                </DropdownMenuItem>
              ))}
              {labels.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No labels</div>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Archive */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={loading}
        onClick={() => executeBulk('archive', true)}
        title="Archive"
      >
        <Archive className="h-3.5 w-3.5" />
      </Button>

      {/* Star */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={loading}
        onClick={() => executeBulk('star', true)}
        title="Star"
      >
        <Star className="h-3.5 w-3.5" />
      </Button>

      {loading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onClearSelection}
        title="Clear selection"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
