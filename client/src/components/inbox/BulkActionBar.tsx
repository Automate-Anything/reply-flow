import { useState, useRef } from 'react';
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
import { Archive, Flag, Loader2, Mail, MailOpen, Pin, Plus, Star, Tag, UserPlus, CircleDot, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import api from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { TeamMember } from '@/hooks/useTeamMembers';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';
import type { ConversationPriority } from '@/hooks/useConversationPriorities';
import { usePlan } from '@/contexts/PlanContext';

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
  onLabelsCreated?: () => void;
  statuses?: ConversationStatus[];
  priorities?: ConversationPriority[];
}

const FALLBACK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function BulkActionBar({
  selectedIds,
  onClearSelection,
  onActionComplete,
  teamMembers,
  labels,
  onLabelsCreated,
  statuses = [],
  priorities = [],
}: BulkActionBarProps) {
  const { hasActivePlan, planLoading, openNoPlanModal } = usePlan();
  const [loading, setLoading] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creatingLabel, setCreatingLabel] = useState(false);
  const newLabelInputRef = useRef<HTMLInputElement>(null);
  const priorityOptions = priorities.length > 0
    ? priorities
    : [
        { id: 'urgent', name: 'Urgent', color: '#EF4444', sort_order: 0, is_default: false },
        { id: 'high', name: 'High', color: '#F97316', sort_order: 1, is_default: false },
        { id: 'medium', name: 'Medium', color: '#EAB308', sort_order: 2, is_default: false },
        { id: 'low', name: 'Low', color: '#3B82F6', sort_order: 3, is_default: false },
        { id: 'none', name: 'None', color: '#9CA3AF', sort_order: 4, is_default: true },
      ];

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || creatingLabel) return;
    setCreatingLabel(true);
    try {
      await api.post('/labels', { name });
      setNewLabelName('');
      onLabelsCreated?.();
      toast.success('Label created');
    } catch {
      toast.error('Failed to create label');
    } finally {
      setCreatingLabel(false);
    }
  };

  const executeBulk = async (action: string, value: unknown) => {
    if (!planLoading && !hasActivePlan) {
      openNoPlanModal();
      return;
    }
    setLoading(true);
    try {
      await api.post('/conversations/bulk', { sessionIds: selectedIds, action, value });
      onActionComplete();
      onClearSelection();
      toast.success(`Updated ${selectedIds.length} conversations`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Bulk action failed');
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
              <div className="flex flex-col">
                <span>{m.full_name}</span>
                <span className="text-xs text-muted-foreground">{m.email}</span>
              </div>
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
          {(statuses.length > 0
            ? statuses.map((s) => ({ value: s.name, label: s.name }))
            : FALLBACK_STATUSES
          ).map((s) => (
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
          {priorityOptions.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => executeBulk('priority', p.name)}>
              <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
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
              {labels.length > 0 && <DropdownMenuSeparator />}
              <div className="flex items-center gap-1 px-1 py-1" onKeyDown={(e) => e.stopPropagation()}>
                <Input
                  ref={newLabelInputRef}
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') handleCreateLabel();
                  }}
                  placeholder="New label..."
                  className="h-7 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  disabled={!newLabelName.trim() || creatingLabel}
                  onClick={handleCreateLabel}
                >
                  {creatingLabel ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                </Button>
              </div>
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
      <ConfirmDialog
        title={`Archive ${selectedIds.length} conversation${selectedIds.length === 1 ? '' : 's'}?`}
        description="Archived conversations can be found in the archived filter."
        actionLabel="Archive"
        onConfirm={() => executeBulk('archive', true)}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={loading}
          title="Archive"
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </ConfirmDialog>

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

      {/* Pin */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={loading}
        onClick={() => executeBulk('pin', true)}
        title="Pin"
      >
        <Pin className="h-3.5 w-3.5" />
      </Button>

      {/* Mark Read */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={loading}
        onClick={() => executeBulk('mark_read', true)}
        title="Mark as read"
      >
        <MailOpen className="h-3.5 w-3.5" />
      </Button>

      {/* Mark Unread */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={loading}
        onClick={() => executeBulk('mark_unread', true)}
        title="Mark as unread"
      >
        <Mail className="h-3.5 w-3.5" />
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
