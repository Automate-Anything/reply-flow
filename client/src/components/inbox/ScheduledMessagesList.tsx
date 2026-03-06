import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CalendarClock, Clock, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ScheduledMessage } from '@/hooks/useScheduledMessages';
import ScheduledMessageEditDialog from './ScheduledMessageEditDialog';

interface ScheduledMessagesListProps {
  messages: ScheduledMessage[];
  loading: boolean;
  onUpdate: (messageId: string, updates: { body?: string; scheduledFor?: string }) => Promise<unknown>;
  onCancel: (messageId: string) => Promise<void>;
}

function formatScheduledTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return 'Sending soon...';

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `In ${diffMin}m`;

  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 24) return `In ${diffH}h`;

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ScheduledMessagesList({
  messages,
  loading,
  onUpdate,
  onCancel,
}: ScheduledMessagesListProps) {
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (id: string) => {
    try {
      await onCancel(id);
      toast.success('Scheduled message cancelled');
    } catch {
      toast.error('Failed to cancel message');
    }
    setCancellingId(null);
  };

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col">
        <div className="space-y-1 p-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto p-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-muted-foreground">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <CalendarClock className="h-7 w-7 opacity-40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No scheduled messages</p>
              <p className="mt-0.5 text-xs">
                Messages you schedule will appear here
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const contactName = msg.session?.contact_name || msg.session?.phone_number || 'Unknown';
            const initial = (contactName[0] || '?').toUpperCase();

            return (
              <div
                key={msg.id}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-lg px-3 py-3 transition-colors',
                  'hover:bg-accent'
                )}
              >
                <Avatar className="mt-0.5 h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initial}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {contactName}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingMessage(msg)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit message
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setCancellingId(msg.id)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Cancel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {msg.message_body || '(empty)'}
                  </p>

                  <div className="mt-1 flex items-center gap-1">
                    <Badge
                      variant="secondary"
                      className="h-4 gap-0.5 px-1.5 text-[10px]"
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {formatScheduledTime(msg.scheduled_for)}
                    </Badge>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit dialog */}
      <ScheduledMessageEditDialog
        message={editingMessage}
        onClose={() => setEditingMessage(null)}
        onSave={async (updates) => {
          if (!editingMessage) return;
          try {
            await onUpdate(editingMessage.id, updates);
            toast.success('Scheduled message updated');
            setEditingMessage(null);
          } catch {
            toast.error('Failed to update message');
          }
        }}
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={!!cancellingId}
        onOpenChange={(open) => { if (!open) setCancellingId(null); }}
        title="Cancel scheduled message?"
        description="This message will not be sent. This action cannot be undone."
        actionLabel="Cancel message"
        variant="destructive"
        onConfirm={() => cancellingId && handleCancel(cancellingId)}
      />
    </div>
  );
}
