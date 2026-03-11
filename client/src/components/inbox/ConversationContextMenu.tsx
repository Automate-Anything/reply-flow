import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Archive,
  Check,
  CircleDot,
  Clock,
  Flag,
  Loader2,
  Mail,
  MailOpen,
  Pin,
  Star,
  Tag,
  UserPlus,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Conversation } from '@/hooks/useConversations';
import type { TeamMember } from '@/hooks/useTeamMembers';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

interface ConversationContextMenuProps {
  conversation: Conversation;
  teamMembers: TeamMember[];
  labels: LabelOption[];
  statuses?: ConversationStatus[];
  onUpdate: () => void;
  children: React.ReactNode;
}

const FALLBACK_STATUSES = [
  { value: 'open', label: 'Open', color: '#22C55E' },
  { value: 'pending', label: 'Pending', color: '#EAB308' },
  { value: 'resolved', label: 'Resolved', color: '#3B82F6' },
  { value: 'closed', label: 'Closed', color: '#6B7280' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', dotColor: 'bg-red-500' },
  { value: 'high', label: 'High', dotColor: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', dotColor: 'bg-yellow-500' },
  { value: 'low', label: 'Low', dotColor: 'bg-blue-500' },
  { value: 'none', label: 'None', dotColor: 'bg-gray-300' },
];

const SNOOZE_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '3 hours', hours: 3 },
  { label: 'Tomorrow 9am', hours: -1 },
  { label: 'Next week', hours: -2 },
];

function getSnoozeUntil(option: (typeof SNOOZE_OPTIONS)[number]): string {
  const now = new Date();
  if (option.hours === -1) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  if (option.hours === -2) {
    const nextMonday = new Date(now);
    const dayOfWeek = nextMonday.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    return nextMonday.toISOString();
  }
  return new Date(now.getTime() + option.hours * 3600000).toISOString();
}

export default function ConversationContextMenu({
  conversation,
  teamMembers,
  labels,
  statuses = [],
  onUpdate,
  children,
}: ConversationContextMenuProps) {
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [labelLoading, setLabelLoading] = useState<string | null>(null);

  const statusOptions = statuses.length > 0
    ? statuses.map((s) => ({ value: s.name, label: s.name, color: s.color }))
    : FALLBACK_STATUSES;
  const hasUnread = conversation.unread_count > 0 || conversation.marked_unread;
  const isSnoozed =
    conversation.snoozed_until && new Date(conversation.snoozed_until) > new Date();
  const assignedIds = new Set(conversation.labels.map((label) => label.id));

  const patch = async (updates: Record<string, unknown>) => {
    try {
      await api.patch(`/conversations/${conversation.id}`, updates);
      onUpdate();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update conversation');
    }
  };

  const handleToggleLabel = async (label: LabelOption) => {
    setLabelLoading(label.id);
    try {
      if (assignedIds.has(label.id)) {
        await api.delete(`/labels/assign/${conversation.id}/${label.id}`);
      } else {
        await api.post('/labels/assign', {
          sessionId: conversation.id,
          labelId: label.id,
        });
      }
      onUpdate();
    } catch {
      toast.error('Failed to update label');
    } finally {
      setLabelLoading(null);
    }
  };

  const handleArchive = async () => {
    try {
      await api.post(`/conversations/${conversation.id}/archive`, { archived: !conversation.is_archived });
      onUpdate();
      toast.success(conversation.is_archived ? 'Conversation unarchived' : 'Conversation archived');
    } catch {
      toast.error('Failed to archive conversation');
    }
  };

  const handleMarkRead = async () => {
    try {
      await api.post(`/conversations/${conversation.id}/read`);
      onUpdate();
    } catch {
      toast.error('Failed to mark as read');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {/* Read / Unread */}
        {hasUnread ? (
          <ContextMenuItem onClick={handleMarkRead}>
            <MailOpen className="mr-2 h-3.5 w-3.5" />
            Mark as read
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => patch({ marked_unread: true })}>
            <Mail className="mr-2 h-3.5 w-3.5" />
            Mark as unread
          </ContextMenuItem>
        )}

        {/* Pin / Unpin */}
        <ContextMenuItem
          onClick={() =>
            patch({ pinned_at: conversation.pinned_at ? null : new Date().toISOString() })
          }
        >
          <Pin
            className={cn('mr-2 h-3.5 w-3.5', conversation.pinned_at && 'text-primary')}
          />
          {conversation.pinned_at ? 'Unpin' : 'Pin'}
        </ContextMenuItem>

        {/* Star / Unstar */}
        <ContextMenuItem onClick={() => patch({ is_starred: !conversation.is_starred })}>
          <Star
            className={cn(
              'mr-2 h-3.5 w-3.5',
              conversation.is_starred && 'fill-yellow-400 text-yellow-400'
            )}
          />
          {conversation.is_starred ? 'Unstar' : 'Star'}
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Status */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CircleDot className="mr-2 h-3.5 w-3.5" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {statusOptions.map((s) => (
              <ContextMenuItem key={s.value} onClick={() => patch({ status: s.value })}>
                <CircleDot className="mr-2 h-3 w-3" style={{ color: s.color }} />
                {s.label}
                {conversation.status === s.value && <Check className="ml-auto h-3 w-3" />}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Assign */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <UserPlus className="mr-2 h-3.5 w-3.5" />
            Assign
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => patch({ assigned_to: null })}>
              <X className="mr-2 h-3 w-3" />
              Unassign
              {!conversation.assigned_to && <Check className="ml-auto h-3 w-3" />}
            </ContextMenuItem>
            {teamMembers.map((m) => (
              <ContextMenuItem
                key={m.user_id}
                onClick={() => patch({ assigned_to: m.user_id })}
              >
                <div className="flex flex-col">
                  <span>{m.full_name}</span>
                  <span className="text-xs text-muted-foreground">{m.email}</span>
                </div>
                {conversation.assigned_to === m.user_id && (
                  <Check className="ml-auto h-3 w-3 shrink-0" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Labels */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Tag className="mr-2 h-3.5 w-3.5" />
            Labels
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {labels.map((label) => (
              <ContextMenuItem
                key={label.id}
                onClick={() => handleToggleLabel(label)}
                disabled={labelLoading === label.id}
              >
                {labelLoading === label.id ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                )}
                {label.name}
                {assignedIds.has(label.id) && <Check className="ml-auto h-3 w-3" />}
              </ContextMenuItem>
            ))}
            {labels.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No labels</div>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Priority */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Flag className="mr-2 h-3.5 w-3.5" />
            Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_OPTIONS.map((p) => (
              <ContextMenuItem key={p.value} onClick={() => patch({ priority: p.value })}>
                <span className={cn('mr-2 h-2 w-2 rounded-full', p.dotColor)} />
                {p.label}
                {conversation.priority === p.value && (
                  <Check className="ml-auto h-3 w-3" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Snooze */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Clock className="mr-2 h-3.5 w-3.5" />
            {isSnoozed ? 'Snoozed' : 'Snooze'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {isSnoozed && (
              <>
                <ContextMenuItem onClick={() => patch({ snoozed_until: null })}>
                  Unsnooze
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {SNOOZE_OPTIONS.map((opt) => (
              <ContextMenuItem
                key={opt.label}
                onClick={() => patch({ snoozed_until: getSnoozeUntil(opt) })}
              >
                {opt.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Archive */}
        <ContextMenuItem
          onClick={() => {
            if (conversation.is_archived) {
              handleArchive();
            } else {
              setConfirmArchiveOpen(true);
            }
          }}
          className="text-destructive focus:text-destructive"
        >
          <Archive className="mr-2 h-3.5 w-3.5" />
          {conversation.is_archived ? 'Unarchive' : 'Archive'}
        </ContextMenuItem>
      </ContextMenuContent>

      <ConfirmDialog
        open={confirmArchiveOpen}
        onOpenChange={setConfirmArchiveOpen}
        title="Archive this conversation?"
        description="Archived conversations can be found in the archived filter."
        actionLabel="Archive"
        onConfirm={handleArchive}
      />
    </ContextMenu>
  );
}
