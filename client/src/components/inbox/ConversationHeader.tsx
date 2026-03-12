import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Archive,
  ArrowLeft,
  Check,
  CircleDot,
  Clock,
  Flag,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Pin,
  Plus,
  Star,
  StickyNote,
  Tag,
  UserPlus,
  CalendarClock,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { getTomorrowAt, getNextMondayAt } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import type { Conversation } from '@/hooks/useConversations';
import type { TeamMember } from '@/hooks/useTeamMembers';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';
import type { ConversationPriority } from '@/hooks/useConversationPriorities';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import AIToggle from '@/components/ai/AIToggle';
import SnoozeCustomDialog from '@/components/inbox/SnoozeCustomDialog';
import AccessManager from '@/components/access/AccessManager';
import { useConversationAccess } from '@/hooks/useAccessControl';

interface ConversationHeaderProps {
  conversation: Conversation;
  onArchive: () => void | Promise<void>;
  onLabelsChange: () => void;
  onBack?: () => void;
  onConversationUpdate?: (updated: Conversation) => void;
  onOpenContact?: () => void;
  onToggleNotes?: () => void;
  teamMembers?: TeamMember[];
  statuses?: ConversationStatus[];
  priorities?: ConversationPriority[];
  onPriorityMetadataNeeded?: () => void;
  notesPanelOpen?: boolean;
  onLabelsCreated?: () => void;
}

interface LabelOption {
  id: string;
  name: string;
  color: string;
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

export default function ConversationHeader({
  conversation,
  onArchive,
  onLabelsChange,
  onBack,
  onConversationUpdate,
  onOpenContact,
  onToggleNotes,
  teamMembers = [],
  statuses = [],
  priorities = [],
  onPriorityMetadataNeeded,
  notesPanelOpen,
  onLabelsCreated,
}: ConversationHeaderProps) {
  const { companyTimezone } = useSession();
  const [allLabels, setAllLabels] = useState<LabelOption[]>([]);
  const [labelLoading, setLabelLoading] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [patchLoading, setPatchLoading] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [snoozeCustomOpen, setSnoozeCustomOpen] = useState(false);
  const newLabelInputRef = useRef<HTMLInputElement>(null);

  const fetchLabels = () => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  };

  useEffect(() => {
    fetchLabels();
  }, []);

  const assignedIds = new Set(conversation.labels.map((l) => l.id));

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || creatingLabel) return;
    setCreatingLabel(true);
    try {
      const { data } = await api.post('/labels', { name });
      setAllLabels((prev) => [...prev, data.label]);
      setNewLabelName('');
      onLabelsCreated?.();
      toast.success('Label created');
    } catch {
      toast.error('Failed to create label');
    } finally {
      setCreatingLabel(false);
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
      onLabelsChange();
    } catch {
      toast.error('Failed to update label');
    } finally {
      setLabelLoading(null);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await onArchive();
    } finally {
      setArchiving(false);
    }
  };

  const patchConversation = async (updates: Record<string, unknown>) => {
    setPatchLoading(true);
    try {
      const { data } = await api.patch(`/conversations/${conversation.id}`, updates);
      onConversationUpdate?.(data.session);
      onLabelsChange();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update conversation');
    } finally {
      setPatchLoading(false);
    }
  };

  const conversationAccess = useConversationAccess(conversation.id);

  // Determine if there's an "all" entry (user_id=null) in the access list
  const hasAllAccess = (conversationAccess.settings?.access_list || []).some(
    (entry) => !entry.user_id
  );

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
  const currentStatus = statusOptions.find((s) => s.value === conversation.status);
  const isSnoozed =
    conversation.snoozed_until && new Date(conversation.snoozed_until) > new Date();

  return (
    <div className="flex items-center justify-between border-b px-4 py-3" data-component="ConversationHeader">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <button
          className="group flex items-center gap-2 text-left"
          onClick={onOpenContact}
          title="View contact details"
        >
          <Avatar className="h-9 w-9 shrink-0">
            {conversation.profile_picture_url && (
              <AvatarImage src={conversation.profile_picture_url} alt={conversation.contact_name || ''} />
            )}
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {((conversation.contact_name || conversation.phone_number)[0] || '?').toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold group-hover:underline">
              {conversation.contact_name || conversation.phone_number}
            </h2>
            <p className="text-xs text-muted-foreground">{conversation.phone_number}</p>
          </div>
        </button>
        {conversation.labels.map((label) => (
          <Badge
            key={label.id}
            variant="outline"
            className="hidden text-xs sm:inline-flex"
            style={{ borderColor: label.color, color: label.color }}
          >
            {label.name}
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <AIToggle
          sessionId={conversation.id}
          humanTakeover={conversation.human_takeover}
          onUpdate={onLabelsChange}
        />

        {/* Manage Access — controls who can see this conversation */}
        {conversationAccess.settings && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <AccessManager
                    title="Manage access"
                    description="Control who can see this conversation and its messages. This is separate from assignment — assigning determines who is responsible for responding."
                    sharingMode="specific_users"
                    accessList={conversationAccess.settings.access_list}
                    teamMembers={teamMembers}
                    onSharingModeChange={async () => {}}
                    onGrantAccess={conversationAccess.grantAccess}
                    onRevokeAccess={conversationAccess.revokeAccess}
                    showGrantToAll
                    onGrantToAll={conversationAccess.grantAccessToAll}
                    onRevokeFromAll={conversationAccess.revokeAccessFromAll}
                    hasAllAccess={hasAllAccess}
                    trigger={
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Manage access">
                        <Lock className="h-4 w-4" />
                      </Button>
                    }
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Manage access — who can see this conversation</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Labels */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Labels">
              <Tag className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {allLabels.map((label) => (
              <DropdownMenuItem
                key={label.id}
                onClick={() => handleToggleLabel(label)}
                disabled={labelLoading === label.id}
              >
                {labelLoading === label.id ? (
                  <Loader2 className="mr-2 h-2 w-2 animate-spin" />
                ) : (
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                )}
                {label.name}
                {assignedIds.has(label.id) && (
                  <X className="ml-auto h-3 w-3 text-muted-foreground" />
                )}
              </DropdownMenuItem>
            ))}
            {allLabels.length > 0 && <DropdownMenuSeparator />}
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
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={patchLoading}
              title="Priority"
              onClick={onPriorityMetadataNeeded}
            >
              <Flag className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {priorityOptions.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => patchConversation({ priority: p.name })}
              >
                <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
                {conversation.priority === p.name && (
                  <Check className="ml-auto h-3 w-3" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={patchLoading}
              title="Assign"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => patchConversation({ assigned_to: null })}>
              <X className="mr-2 h-3 w-3" />
              Unassign
              {!conversation.assigned_to && <Check className="ml-auto h-3 w-3" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {teamMembers.map((m) => (
              <DropdownMenuItem
                key={m.user_id}
                onClick={() => patchConversation({ assigned_to: m.user_id })}
              >
                <div className="flex flex-col">
                  <span>{m.full_name}</span>
                  <span className="text-xs text-muted-foreground">{m.email}</span>
                </div>
                {conversation.assigned_to === m.user_id && (
                  <Check className="ml-auto h-3 w-3 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Status */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={patchLoading}
              title={`Status: ${currentStatus?.label}`}
            >
              <CircleDot className="h-4 w-4" style={{ color: currentStatus?.color }} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {statusOptions.map((s) => (
              <DropdownMenuItem
                key={s.value}
                onClick={() => patchConversation({ status: s.value })}
              >
                <CircleDot className="mr-2 h-3 w-3" style={{ color: s.color }} />
                {s.label}
                {conversation.status === s.value && <Check className="ml-auto h-3 w-3" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* More actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Star */}
            <DropdownMenuItem
              onClick={() => patchConversation({ is_starred: !conversation.is_starred })}
              disabled={patchLoading}
            >
              <Star
                className={cn(
                  'mr-2 h-3.5 w-3.5',
                  conversation.is_starred && 'fill-yellow-400 text-yellow-400'
                )}
              />
              {conversation.is_starred ? 'Unstar' : 'Star'}
            </DropdownMenuItem>

            {/* Pin / Unpin */}
            <DropdownMenuItem
              onClick={() =>
                patchConversation({ pinned_at: conversation.pinned_at ? null : new Date().toISOString() })
              }
              disabled={patchLoading}
            >
              <Pin
                className={cn(
                  'mr-2 h-3.5 w-3.5',
                  conversation.pinned_at && 'text-primary'
                )}
              />
              {conversation.pinned_at ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>

            {/* Mark as unread */}
            <DropdownMenuItem
              onClick={() => patchConversation({ marked_unread: true })}
              disabled={patchLoading}
            >
              <Mail className="mr-2 h-3.5 w-3.5" />
              Mark as unread
            </DropdownMenuItem>

            {/* Notes */}
            {onToggleNotes && (
              <DropdownMenuItem onClick={onToggleNotes}>
                <StickyNote className="mr-2 h-3.5 w-3.5" />
                {notesPanelOpen ? 'Hide notes' : 'Notes'}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Snooze */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Clock className="mr-2 h-3.5 w-3.5" />
                {isSnoozed ? 'Snoozed' : 'Snooze'}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {isSnoozed && (
                  <>
                    <DropdownMenuItem
                      onClick={() => patchConversation({ snoozed_until: null })}
                    >
                      Unsnooze
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {SNOOZE_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.label}
                    onClick={() =>
                      patchConversation({ snoozed_until: getSnoozeUntil(opt, companyTimezone) })
                    }
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSnoozeCustomOpen(true)}>
                  <CalendarClock className="mr-2 h-3.5 w-3.5" />
                  Custom date &amp; time
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Archive */}
            <DropdownMenuItem
              onClick={() => setConfirmArchiveOpen(true)}
              disabled={archiving}
              className="text-destructive focus:text-destructive"
            >
              {archiving ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="mr-2 h-3.5 w-3.5" />
              )}
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirmArchiveOpen}
        onOpenChange={setConfirmArchiveOpen}
        title="Archive this conversation?"
        description="Archived conversations can be found in the archived filter."
        actionLabel="Archive"
        onConfirm={handleArchive}
        loading={archiving}
      />

      <SnoozeCustomDialog
        open={snoozeCustomOpen}
        onOpenChange={setSnoozeCustomOpen}
        onSnooze={(until) => patchConversation({ snoozed_until: until })}
      />
    </div>
  );
}
