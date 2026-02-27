import { useState, useEffect } from 'react';
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
import {
  Archive,
  ArrowLeft,
  Check,
  CircleDot,
  Clock,
  Flag,
  Loader2,
  MoreHorizontal,
  Star,
  StickyNote,
  Tag,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/hooks/useConversations';
import type { TeamMember } from '@/hooks/useTeamMembers';
import AIToggle from '@/components/ai/AIToggle';

interface ConversationHeaderProps {
  conversation: Conversation;
  onArchive: () => void | Promise<void>;
  onLabelsChange: () => void;
  onBack?: () => void;
  onConversationUpdate?: (updated: Conversation) => void;
  onOpenContact?: () => void;
  onToggleNotes?: () => void;
  teamMembers?: TeamMember[];
  notesPanelOpen?: boolean;
}

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: 'text-green-600' },
  { value: 'pending', label: 'Pending', color: 'text-yellow-600' },
  { value: 'resolved', label: 'Resolved', color: 'text-blue-600' },
  { value: 'closed', label: 'Closed', color: 'text-gray-500' },
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
    // Tomorrow 9am
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  if (option.hours === -2) {
    // Next Monday 9am
    const nextMonday = new Date(now);
    const dayOfWeek = nextMonday.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    return nextMonday.toISOString();
  }
  return new Date(now.getTime() + option.hours * 3600000).toISOString();
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
  notesPanelOpen,
}: ConversationHeaderProps) {
  const [allLabels, setAllLabels] = useState<LabelOption[]>([]);
  const [labelLoading, setLabelLoading] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [patchLoading, setPatchLoading] = useState(false);

  useEffect(() => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  }, []);

  const assignedIds = new Set(conversation.labels.map((l) => l.id));

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
    } catch {
      toast.error('Failed to update conversation');
    } finally {
      setPatchLoading(false);
    }
  };

  const currentStatus = STATUS_OPTIONS.find((s) => s.value === conversation.status);
  const isSnoozed =
    conversation.snoozed_until && new Date(conversation.snoozed_until) > new Date();

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0">
          <button
            className="group flex items-center gap-1 text-left"
            onClick={onOpenContact}
            title="View contact details"
          >
            <h2 className="truncate text-sm font-semibold group-hover:underline">
              {conversation.contact_name || conversation.phone_number}
            </h2>
          </button>
          <p className="text-xs text-muted-foreground">{conversation.phone_number}</p>
        </div>
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

        {/* Assign */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={patchLoading}
              title="Assign conversation"
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
                {m.full_name}
                {conversation.assigned_to === m.user_id && (
                  <Check className="ml-auto h-3 w-3" />
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
              <CircleDot className={cn('h-4 w-4', currentStatus?.color)} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {STATUS_OPTIONS.map((s) => (
              <DropdownMenuItem
                key={s.value}
                onClick={() => patchConversation({ status: s.value })}
              >
                <CircleDot className={cn('mr-2 h-3 w-3', s.color)} />
                {s.label}
                {conversation.status === s.value && <Check className="ml-auto h-3 w-3" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Star */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={patchLoading}
          onClick={() => patchConversation({ is_starred: !conversation.is_starred })}
          title={conversation.is_starred ? 'Unstar' : 'Star'}
        >
          <Star
            className={cn(
              'h-4 w-4',
              conversation.is_starred && 'fill-yellow-400 text-yellow-400'
            )}
          />
        </Button>

        {/* Labels */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Tag className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {allLabels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No labels created yet
              </div>
            ) : (
              allLabels.map((label) => (
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
              ))
            )}
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
            {/* Priority */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Flag className="mr-2 h-3.5 w-3.5" />
                Priority
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <DropdownMenuItem
                    key={p.value}
                    onClick={() => patchConversation({ priority: p.value })}
                  >
                    <span className={cn('mr-2 h-2 w-2 rounded-full', p.dotColor)} />
                    {p.label}
                    {conversation.priority === p.value && (
                      <Check className="ml-auto h-3 w-3" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

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
                      patchConversation({ snoozed_until: getSnoozeUntil(opt) })
                    }
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Notes */}
            {onToggleNotes && (
              <DropdownMenuItem onClick={onToggleNotes}>
                <StickyNote className="mr-2 h-3.5 w-3.5" />
                {notesPanelOpen ? 'Hide notes' : 'Show notes'}
              </DropdownMenuItem>
            )}

            {/* View contact */}
            {onOpenContact && (
              <DropdownMenuItem onClick={onOpenContact}>
                <User className="mr-2 h-3.5 w-3.5" />
                View contact
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Archive */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleArchive}
          disabled={archiving}
        >
          {archiving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
