import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, Pencil, Trash2, StickyNote } from 'lucide-react';
import { useContactNotes, type ContactNote } from '@/hooks/useContactNotes';

interface ContactNotesProps {
  contactId: string;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function AuthorAvatar({ author }: { author?: ContactNote['author'] }) {
  if (author?.avatar_url) {
    return (
      <img
        src={author.avatar_url}
        alt={author.full_name}
        className="h-7 w-7 rounded-full object-cover"
      />
    );
  }

  const initial = (author?.full_name?.[0] ?? '?').toUpperCase();
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {initial}
    </div>
  );
}

export default function ContactNotes({ contactId }: ContactNotesProps) {
  const { notes, loading, addNote, updateNote, deleteNote } = useContactNotes(contactId);

  const [newContent, setNewContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await addNote(trimmed);
      setNewContent('');
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAdd();
    }
  };

  const startEdit = (note: ContactNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;
    setSavingEdit(true);
    try {
      await updateNote(editingId, trimmed);
      setEditingId(null);
      setEditContent('');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add note area */}
      <div className="space-y-2">
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note..."
          rows={3}
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newContent.trim() || adding}
          >
            {adding && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Add note
          </Button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <StickyNote className="mb-2 h-8 w-8" />
          <p className="text-sm">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="group rounded-md border p-3"
            >
              {/* Header: author + time + actions */}
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AuthorAvatar author={note.author} />
                  <span className="text-sm font-medium">
                    {note.author?.full_name ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTimeAgo(note.created_at)}
                  </span>
                </div>

                {editingId !== note.id && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => startEdit(note)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <ConfirmDialog
                      title="Delete this note?"
                      description="This action cannot be undone."
                      onConfirm={async () => {
                        setDeletingId(note.id);
                        try {
                          await deleteNote(note.id);
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      loading={deletingId === note.id}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={deletingId === note.id}
                      >
                        {deletingId === note.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </ConfirmDialog>
                  </div>
                )}
              </div>

              {/* Content or edit mode */}
              {editingId === note.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    rows={3}
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={!editContent.trim() || savingEdit}
                    >
                      {savingEdit && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelEdit}
                      disabled={savingEdit}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{note.content}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
