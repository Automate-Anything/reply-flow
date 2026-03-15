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
  CalendarClock,
  Shield,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { getTomorrowAt, getNextMondayAt } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import SnoozeCustomDialog from '@/components/inbox/SnoozeCustomDialog';
import type { Conversation } from '@/hooks/useConversations';
import type { TeamMember } from '@/hooks/useTeamMembers';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';
import type { ConversationPriority } from '@/hooks/useConversationPriorities';

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
  priorities?: ConversationPriority[];
  onPriorityMetadataNeeded?: () => void;
  onUpdate: () => void;
  onManageAccess?: (sessionId: string) => void;
  children: React.ReactNode;
}

const FALLBACK_STATUSES = [
  { value: 'open', label: 'Open', color: '#22C55E' },
  { value: 'pending', label: 'Pending', color: '#EAB308' },
  { value: 'resolved', label: 'Resolved', color: '#3B82F6' },
  { value: 'closed', label: 'Closed', color: '#6B7280' },
];

const SNOOZE_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '3 hours', hours: 3 },
  { label: 'Tomorrow 9am', hours: -1 },
  { label: 'Next week', hours: -2 },
];

function getSnoozeUntil(option: (typeof SNOOZE_OPTIONS)[number], tz?: string): string {
  if (option.hours === -1) return getTomorrowAt(tz, 9).toISOString();
  if (option.hours === -2) return getNextMondayAt(tz, 9).toISOString();
  return new Date(Date.now() + option.hours * 3600000).toISOString();
}

export default function ConversationContextMenu({
  conversation,
  teamMembers,
  labels,
  statuses = [],
  priorities = [],
  onPriorityMetadataNeeded,
  onUpdate,
  onManageAccess,
  children,
}: ConversationContextMenuProps) {
  const { companyTimezone } = useSession();
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [labelLoading, setLabelLoading] = useState<string | null>(null);
  const [snoozeCustomOpen, setSnoozeCustomOpen] = useState(false);

  const statusOptions = statuses.length > 0
    ? statuses.map((s) => ({ value: s.name, label: s.name, color: s.color }))
    : FALLBACK_STATUSES;
  const priorityOptions = priorities.length > 0
    ? priorities
    : [
        { id: 'urgent', name: 'Urgent', color: '#EF4444', sort_order: 0, is_default: false },
        { id: 'high', name: 'High', color: '#F97316', sort_order: 1, is_default: false },
        { id: 'medium', name: 'Medium', color: '#EAB308', sort_order: 2, is_default: false },
        { id: 'low', name: 'Low', color: '#3B82F6', sort_order: 3, is_default: false },
        { id: 'none', name: 'None', color: '#9CA3AF', sort_order: 4, is_default: true },
      ];
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
      <ContextMenuTrigger onContextMenu={() => onPriorityMetadataNeeded?.()}>{children}</ContextMenuTrigger>
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
            {priorityOptions.map((p) => (
              <ContextMenuItem key={p.id} onClick={() => patch({ priority: p.name })}>
                <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
                {conversation.priority === p.name && (
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
                onClick={() => patch({ snoozed_until: getSnoozeUntil(opt, companyTimezone) })}
              >
                {opt.label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setSnoozeCustomOpen(true)}>
              <CalendarClock className="mr-2 h-3.5 w-3.5" />
              Custom date &amp; time
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Manage access */}
        <ContextMenuItem onClick={() => onManageAccess?.(conversation.id)}>
          <Shield className="mr-2 h-3.5 w-3.5" />
          Manage access
        </ContextMenuItem>

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

      <SnoozeCustomDialog
        open={snoozeCustomOpen}
        onOpenChange={setSnoozeCustomOpen}
        onSnooze={(until) => patch({ snoozed_until: until })}
      />
    </ContextMenu>
  );
}
