import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Loader2, Pencil, Trash2, Phone, Mail, Building2 } from 'lucide-react';
import api from '@/lib/api';
import { useContactNotes } from '@/hooks/useContacts';
import type { Message } from '@/hooks/useMessages';
import ContactNotes from './ContactNotes';
import MessageBubble from '@/components/inbox/MessageBubble';
import type { Contact } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { CustomFieldValue } from '@/hooks/useCustomFields';

interface ContactDetailProps {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
  onBack?: () => void;
  availableTags?: ContactTag[];
  customFieldValues?: CustomFieldValue[];
}

export default function ContactDetail({
  contact,
  onEdit,
  onDelete,
  deleting,
  onBack,
  availableTags = [],
  customFieldValues = [],
}: ContactDetailProps) {
  const { notes, loading: notesLoading, addNote, deleteNote } = useContactNotes(contact.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgsLoaded, setMsgsLoaded] = useState(false);

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    || contact.whatsapp_name
    || contact.phone_number;

  const tagColorMap = new Map(availableTags.map((t) => [t.name, t.color]));

  const hasAddress = contact.address_street || contact.address_city || contact.address_state
    || contact.address_postal_code || contact.address_country;

  const loadMessages = async () => {
    if (msgsLoaded) return;
    setMsgsLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contact.id}/messages`);
      setMessages(data.messages || []);
      setMsgsLoaded(true);
    } finally {
      setMsgsLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 md:px-6">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-semibold">
            {(contact.first_name?.[0] || contact.phone_number[0] || '?').toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{name}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {contact.phone_number}
              </span>
              {contact.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contact.email}
                </span>
              )}
              {contact.company && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {contact.company}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete the contact and all associated data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tags */}
      {contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b px-6 py-2">
          {contact.tags.map((tagName) => {
            const color = tagColorMap.get(tagName);
            return (
              <Badge
                key={tagName}
                variant={color ? 'default' : 'secondary'}
                className="text-xs"
                style={color ? { backgroundColor: color, color: 'white' } : undefined}
              >
                {tagName}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="details" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-4 w-fit">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="messages" onClick={loadMessages}>Messages</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex-1 overflow-auto px-6 py-4">
          <div className="max-w-md space-y-4">
            <InfoRow label="Phone" value={contact.phone_number} />
            <InfoRow label="First Name" value={contact.first_name} />
            <InfoRow label="Last Name" value={contact.last_name} />
            <InfoRow label="Email" value={contact.email} />
            <InfoRow label="Company" value={contact.company} />
            <InfoRow label="WhatsApp Name" value={contact.whatsapp_name} />
            {contact.notes && <InfoRow label="Notes" value={contact.notes} />}

            {/* Address */}
            {hasAddress && (
              <>
                <Separator className="my-4" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</h4>
                <InfoRow label="Street" value={contact.address_street} />
                <InfoRow label="City" value={contact.address_city} />
                <InfoRow label="State / Province" value={contact.address_state} />
                <InfoRow label="Postal Code" value={contact.address_postal_code} />
                <InfoRow label="Country" value={contact.address_country} />
              </>
            )}

            {/* Custom Fields */}
            {customFieldValues.length > 0 && (
              <>
                <Separator className="my-4" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Additional Information</h4>
                {customFieldValues.map((cfv) => (
                  <InfoRow
                    key={cfv.id}
                    label={cfv.field_definition.name}
                    value={
                      cfv.field_definition.field_type === 'multi_select'
                        ? (cfv.value_json || []).join(', ')
                        : cfv.value
                    }
                  />
                ))}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="messages" className="flex-1 overflow-auto px-6 py-4">
          {msgsLoading ? (
            <p className="text-sm text-muted-foreground">Loading messages...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No message history with this contact</p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes" className="flex-1 overflow-auto px-6 py-4">
          <ContactNotes
            notes={notes}
            loading={notesLoading}
            onAdd={async (content) => { await addNote(content); }}
            onDelete={async (noteId) => { await deleteNote(noteId); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  );
}
