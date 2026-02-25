import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, Plus } from 'lucide-react';
import type { ContactNote } from '@/hooks/useContacts';

interface ContactNotesProps {
  notes: ContactNote[];
  loading: boolean;
  onAdd: (content: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ContactNotes({ notes, loading, onAdd, onDelete }: ContactNotesProps) {
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await onAdd(trimmed);
      setNewNote('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          size="icon"
          onClick={handleAdd}
          disabled={!newNote.trim() || adding}
          className="h-9 w-9 shrink-0 self-end"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No notes yet</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="group flex items-start justify-between rounded-md border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(note.created_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onDelete(note.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
