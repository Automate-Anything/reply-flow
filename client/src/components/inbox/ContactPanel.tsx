import { useState, useEffect, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { Loader2, Pencil, Save, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useContactNotes, type Contact, type ContactNote } from '@/hooks/useContacts';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';

interface ContactPanelProps {
  contactId: string | null;
  open: boolean;
  onClose: () => void;
  onProfilePictureLoaded?: (url: string) => void;
  /** Pre-loaded data from conversation for instant header display while full contact loads */
  previewName?: string | null;
  previewPhone?: string | null;
  previewPicture?: string | null;
}

export default function ContactPanel({ contactId, open, onClose, onProfilePictureLoaded, previewName, previewPhone, previewPicture }: ContactPanelProps) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', company: '' });
  const [originalForm, setOriginalForm] = useState({ first_name: '', last_name: '', email: '', company: '' });

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(form, editing ? originalForm : null);
  useFormDirtyGuard(isDirty);

  const { notes, loading: notesLoading, addNote, deleteNote } = useContactNotes(
    open ? contactId : null
  );
  const [newNote, setNewNote] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contactId}`);
      setContact(data.contact);
      setForm({
        first_name: data.contact.first_name || '',
        last_name: data.contact.last_name || '',
        email: data.contact.email || '',
        company: data.contact.company || '',
      });
      if (data.contact.profile_picture_url) {
        onProfilePictureLoaded?.(data.contact.profile_picture_url);
      }
    } catch {
      toast.error('Failed to load contact');
    } finally {
      setLoading(false);
    }
  }, [contactId, onProfilePictureLoaded]);

  // Clear stale contact data immediately when switching contacts
  useEffect(() => {
    setContact(null);
    setEditing(false);
  }, [contactId]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
    }
  }, [open, contactId, fetchContact]);

  const handleSave = async () => {
    if (!contactId) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/contacts/${contactId}`, form);
      setContact(data.contact);
      setEditing(false);
      toast.success('Contact updated');
    } catch {
      toast.error('Failed to update contact');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    const trimmed = newNote.trim();
    if (!trimmed || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await addNote(trimmed);
      setNewNote('');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNote(noteId);
    } catch {
      toast.error('Failed to delete note');
    }
  };

  const displayName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
      contact.whatsapp_name ||
      contact.phone_number
    : previewName || previewPhone || '';

  return (
    <Sheet open={open} onOpenChange={(v) => {
        if (!v) {
          if (editing) {
            guardedClose(() => {
              setEditing(false);
              if (contact) {
                setForm({
                  first_name: contact.first_name || '',
                  last_name: contact.last_name || '',
                  email: contact.email || '',
                  company: contact.company || '',
                });
              }
              onClose();
            });
          } else {
            onClose();
          }
        }
      }}>
      <SheetContent className="w-[380px] overflow-y-auto p-0 sm:max-w-[380px]">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              {(contact?.profile_picture_url || previewPicture) && (
                <AvatarImage src={(contact?.profile_picture_url || previewPicture)!} alt={displayName} />
              )}
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                {(displayName[0] || '?').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm">{displayName}</SheetTitle>
              <p className="text-xs text-muted-foreground">{contact?.phone_number || previewPhone}</p>
            </div>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : contact ? (
          <Tabs defaultValue="info" className="w-full">
            <TabsList className="w-full rounded-none border-b">
              <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
              <TabsTrigger value="notes" className="flex-1">
                Notes {notes.length > 0 && `(${notes.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="mt-0 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Contact Details</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    if (editing) {
                      guardedClose(() => {
                        setForm({
                          first_name: contact.first_name || '',
                          last_name: contact.last_name || '',
                          email: contact.email || '',
                          company: contact.company || '',
                        });
                        setEditing(false);
                      });
                    } else {
                      setOriginalForm({ ...form });
                      setEditing(true);
                    }
                  }}
                >
                  {editing ? (
                    <>
                      <X className="mr-1 h-3 w-3" /> Cancel
                    </>
                  ) : (
                    <>
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">First Name</Label>
                    {editing ? (
                      <Input
                        value={form.first_name}
                        onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                        className="mt-1 h-8 text-sm"
                      />
                    ) : (
                      <p className="mt-1 text-sm">{contact.first_name || '-'}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Last Name</Label>
                    {editing ? (
                      <Input
                        value={form.last_name}
                        onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                        className="mt-1 h-8 text-sm"
                      />
                    ) : (
                      <p className="mt-1 text-sm">{contact.last_name || '-'}</p>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Phone</Label>
                  <p className="mt-1 text-sm">{contact.phone_number}</p>
                </div>

                <div>
                  <Label className="text-xs">Email</Label>
                  {editing ? (
                    <Input
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="mt-1 h-8 text-sm"
                      type="email"
                    />
                  ) : (
                    <p className="mt-1 text-sm">{contact.email || '-'}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs">Company</Label>
                  {editing ? (
                    <Input
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="mt-1 h-8 text-sm"
                    />
                  ) : (
                    <p className="mt-1 text-sm">{contact.company || '-'}</p>
                  )}
                </div>

                {contact.whatsapp_name && (
                  <div>
                    <Label className="text-xs">WhatsApp Name</Label>
                    <p className="mt-1 text-sm">{contact.whatsapp_name}</p>
                  </div>
                )}

                {contact.tags.length > 0 && (
                  <div>
                    <Label className="text-xs">Tags</Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {contact.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {editing && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    className="mt-2 w-full"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-3 w-3" />
                    )}
                    Save Changes
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="notes" className="mt-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4">
                {notesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : notes.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No notes yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {notes.map((note: ContactNote) => (
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
                            {new Date(note.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <ConfirmDialog
                            title="Delete this note?"
                            description="This action cannot be undone."
                            onConfirm={() => handleDeleteNote(note.id)}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-auto h-5 w-5 opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </ConfirmDialog>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t p-3">
                <div className="flex gap-1">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddNote();
                      }
                    }}
                    placeholder="Add a note..."
                    rows={2}
                    className="flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0 self-end"
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || noteSubmitting}
                  >
                    {noteSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Contact not found
          </div>
        )}
      </SheetContent>

      <UnsavedChangesDialog
        open={showDialog}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscard}
        onSave={handleSave}
        saving={saving}
      />
    </Sheet>
  );
}
