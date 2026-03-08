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
import { useState } from 'react';
import { Check, List, Pencil, Tag, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Contact } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { ContactList as ContactListType } from '@/hooks/useContactLists';

interface ContactContextMenuProps {
  contact: Contact;
  availableTags: ContactTag[];
  availableLists: ContactListType[];
  onEdit: (contact: Contact) => void;
  onRefresh: () => void;
  children: React.ReactNode;
}

export default function ContactContextMenu({
  contact,
  availableTags,
  availableLists,
  onEdit,
  onRefresh,
  children,
}: ContactContextMenuProps) {
  const bulkAction = async (action: string, value?: unknown) => {
    try {
      await api.post('/contacts/bulk', { contactIds: [contact.id], action, value });
      onRefresh();
    } catch {
      toast.error('Action failed');
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/contacts/${contact.id}`);
      onRefresh();
      toast.success('Contact deleted');
    } catch {
      toast.error('Failed to delete contact');
    }
  };

  const contactTags = contact.tags || [];
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    || contact.whatsapp_name
    || contact.phone_number;

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {/* Edit */}
        <ContextMenuItem onClick={() => onEdit(contact)}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Edit
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* Tags */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Tag className="mr-2 h-3.5 w-3.5" />
            Tags
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {availableTags.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No tags</div>
            ) : (
              availableTags.map((tag) => {
                const hasTag = contactTags.includes(tag.name);
                return (
                  <ContextMenuItem
                    key={tag.id}
                    onClick={() =>
                      bulkAction(hasTag ? 'tag_remove' : 'tag_add', tag.name)
                    }
                  >
                    <span
                      className="mr-2 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                    {hasTag && <Check className="ml-auto h-3 w-3" />}
                  </ContextMenuItem>
                );
              })
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Lists */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <List className="mr-2 h-3.5 w-3.5" />
            Lists
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {availableLists.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No lists</div>
            ) : (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Add to list</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {availableLists.map((list) => (
                      <ContextMenuItem
                        key={list.id}
                        onClick={() => bulkAction('list_add', list.id)}
                      >
                        <span
                          className="mr-2 h-2 w-2 rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                        {list.name}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Remove from list</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {availableLists.map((list) => (
                      <ContextMenuItem
                        key={list.id}
                        onClick={() => bulkAction('list_remove', list.id)}
                      >
                        <span
                          className="mr-2 h-2 w-2 rounded-full"
                        style={{ backgroundColor: list.color }}
                      />
                      {list.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Delete */}
        <ContextMenuItem
          onClick={() => setConfirmDeleteOpen(true)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <ConfirmDialog
      open={confirmDeleteOpen}
      onOpenChange={setConfirmDeleteOpen}
      title={`Delete ${name}?`}
      description="This will permanently delete this contact. This action cannot be undone."
      onConfirm={() => { setConfirmDeleteOpen(false); handleDelete(); }}
    />
    </>
  );
}
