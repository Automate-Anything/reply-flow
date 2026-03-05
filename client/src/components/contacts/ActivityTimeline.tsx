import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  MessageSquare,
  StickyNote,
  UserPlus,
  Pencil,
  Tag,
  List,
  Upload,
  GitMerge,
  Loader2,
  Trash2,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from '@/hooks/useContactActivity';

interface ActivityTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  onAddNote: (content: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getEventIcon(event: TimelineEvent) {
  switch (event.type) {
    case 'message':
      return {
        icon: MessageSquare,
        color: event.event === 'message_received'
          ? 'text-blue-500 bg-blue-50 dark:bg-blue-950/40'
          : 'text-green-500 bg-green-50 dark:bg-green-950/40',
      };
    case 'note':
      return { icon: StickyNote, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' };
    case 'activity':
      switch (event.event) {
        case 'created':
          return { icon: UserPlus, color: 'text-green-600 bg-green-50 dark:bg-green-950/40' };
        case 'edited':
          return { icon: Pencil, color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' };
        case 'tag_added':
        case 'tag_removed':
          return { icon: Tag, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40' };
        case 'list_added':
        case 'list_removed':
          return { icon: List, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' };
        case 'imported':
          return { icon: Upload, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' };
        case 'merged':
          return { icon: GitMerge, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40' };
        default:
          return { icon: Pencil, color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' };
      }
    default:
      return { icon: Pencil, color: 'text-gray-500 bg-gray-100 dark:bg-gray-800' };
  }
}

function EventContent({ event }: { event: TimelineEvent }) {
  const data = event.data;

  switch (event.type) {
    case 'message': {
      const body = (data.message_body as string) || '';
      const direction = event.event === 'message_received' ? 'Received' : 'Sent';
      return (
        <div>
          <span className="text-xs font-medium">{direction}</span>
          {body && (
            <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{body}</p>
          )}
        </div>
      );
    }
    case 'note':
      return (
        <div>
          <span className="text-xs font-medium">Note added</span>
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-3">
            {data.content as string}
          </p>
        </div>
      );
    case 'activity':
      return <ActivityEventContent event={event.event} data={data} />;
    default:
      return null;
  }
}

function ActivityEventContent({ event, data }: { event: string; data: Record<string, unknown> }) {
  const metadata = (data.metadata || {}) as Record<string, unknown>;

  switch (event) {
    case 'created':
      return <span className="text-xs font-medium">Contact created</span>;
    case 'edited': {
      const changes = (metadata.changes || {}) as Record<
        string,
        { from: unknown; to: unknown }
      >;
      const keys = Object.keys(changes);
      if (keys.length === 0) return <span className="text-xs font-medium">Contact edited</span>;
      return (
        <div>
          <span className="text-xs font-medium">Contact edited</span>
          <div className="mt-0.5 space-y-0.5">
            {keys.slice(0, 3).map((field) => (
              <p key={field} className="text-xs text-muted-foreground">
                <span className="capitalize">{field.replace(/_/g, ' ')}</span>
                {': '}
                <span className="line-through opacity-60">
                  {String(changes[field].from || '—')}
                </span>
                {' → '}
                <span className="font-medium">{String(changes[field].to || '—')}</span>
              </p>
            ))}
            {keys.length > 3 && (
              <p className="text-xs text-muted-foreground">
                +{keys.length - 3} more field{keys.length - 3 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      );
    }
    case 'tag_added':
      return (
        <span className="text-xs font-medium">
          Tag added: <span className="font-normal text-muted-foreground">{metadata.tag as string}</span>
        </span>
      );
    case 'tag_removed':
      return (
        <span className="text-xs font-medium">
          Tag removed: <span className="font-normal text-muted-foreground">{metadata.tag as string}</span>
        </span>
      );
    case 'list_added':
      return (
        <span className="text-xs font-medium">
          Added to list{metadata.list_name ? `: ${metadata.list_name}` : ''}
        </span>
      );
    case 'list_removed':
      return (
        <span className="text-xs font-medium">
          Removed from list{metadata.list_name ? `: ${metadata.list_name}` : ''}
        </span>
      );
    case 'imported':
      return <span className="text-xs font-medium">Imported from CSV</span>;
    case 'merged':
      return (
        <span className="text-xs font-medium">
          Merged with{' '}
          <span className="font-normal text-muted-foreground">
            {(metadata.merged_contact_name as string) || 'another contact'}
          </span>
        </span>
      );
    default:
      return <span className="text-xs font-medium">{event}</span>;
  }
}

export default function ActivityTimeline({
  events,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
  onAddNote,
  onDeleteNote,
}: ActivityTimelineProps) {
  const [noteContent, setNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setAddingNote(true);
    try {
      await onAddNote(noteContent.trim());
      setNoteContent('');
    } finally {
      setAddingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add note input */}
      <div className="flex gap-2">
        <Textarea
          placeholder="Add a note..."
          className="min-h-[60px] resize-none text-sm"
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAddNote();
            }
          }}
        />
        <Button
          size="icon"
          className="h-[60px] w-10 shrink-0"
          disabled={!noteContent.trim() || addingNote}
          onClick={handleAddNote}
        >
          {addingNote ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Timeline */}
      {events.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          No activity yet
        </p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-3">
            {events.map((event, idx) => {
              const { icon: Icon, color } = getEventIcon(event);
              const isNote = event.type === 'note';
              const noteId = isNote ? (event.data.id as string) : null;

              return (
                <div key={`${event.type}-${event.data.id || idx}`} className="group relative flex gap-3 pl-0">
                  {/* Icon */}
                  <div
                    className={cn(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      color
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <EventContent event={event} />
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      {isNote && noteId && (
                        <ConfirmDialog
                          title="Delete this note?"
                          description="This action cannot be undone."
                          onConfirm={() => onDeleteNote(noteId)}
                        >
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            title="Delete note"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </ConfirmDialog>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
