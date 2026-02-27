import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Loader2, Send, StickyNote, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationNotes } from '@/hooks/useConversationNotes';

interface ConversationNotesProps {
  sessionId: string;
  onClose: () => void;
}

function formatNoteDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * dayMs) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationNotes({ sessionId, onClose }: ConversationNotesProps) {
  const { notes, loading, addNote, deleteNote } = useConversationNotes(sessionId);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = newNote.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addNote(trimmed);
      setNewNote('');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDelete = async (noteId: string) => {
    try {
      await deleteNote(noteId);
    } catch {
      toast.error('Failed to delete note');
    }
  };

  return (
    <div className="flex h-full w-[280px] flex-col border-l">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Notes</h3>
          <span className="text-xs text-muted-foreground">({notes.length})</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No notes yet. Add an internal note below.
          </div>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group rounded-md border bg-muted/30 p-2"
              >
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[9px]">
                      {(note.author?.full_name?.[0] || '?').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] font-medium">
                    {note.author?.full_name || 'Unknown'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatNoteDate(note.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-5 w-5 opacity-0 group-hover:opacity-100"
                    onClick={() => handleDelete(note.id)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs">{note.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex gap-1">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add an internal note..."
            rows={2}
            className="flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 self-end"
            onClick={handleSubmit}
            disabled={!newNote.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
