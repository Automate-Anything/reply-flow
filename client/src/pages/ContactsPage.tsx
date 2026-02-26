import { useState } from 'react';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useContacts, type Contact } from '@/hooks/useContacts';
import ContactList from '@/components/contacts/ContactList';
import ContactDetail from '@/components/contacts/ContactDetail';
import ContactForm from '@/components/contacts/ContactForm';

type View = 'detail' | 'new' | 'edit';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [view, setView] = useState<View>('detail');
  const [deleting, setDeleting] = useState(false);
  const { contacts, loading, refetch } = useContacts(search);

  const handleSelect = (contact: Contact) => {
    setActiveContact(contact);
    setView('detail');
  };

  const handleAdd = () => {
    setActiveContact(null);
    setView('new');
  };

  const handleEdit = () => {
    setView('edit');
  };

  const handleDelete = async () => {
    if (!activeContact) return;
    setDeleting(true);
    try {
      await api.delete(`/contacts/${activeContact.id}`);
      setActiveContact(null);
      setView('detail');
      refetch();
      toast.success('Contact deleted');
    } catch {
      toast.error('Failed to delete contact');
    } finally {
      setDeleting(false);
    }
  };

  const handleFormSave = () => {
    setView('detail');
    refetch();
    // If editing, refresh the active contact
    if (activeContact && view === 'edit') {
      api.get(`/contacts/${activeContact.id}`).then(({ data }) => {
        setActiveContact(data.contact);
      });
    } else {
      setActiveContact(null);
    }
  };

  const handleFormCancel = () => {
    setView('detail');
    setActiveContact(null);
  };

  const handleBack = () => {
    setActiveContact(null);
    setView('detail');
  };

  const showingDetail = activeContact || view === 'new' || view === 'edit';

  return (
    <div className="flex h-full">
      {/* Contact list — hidden on mobile when detail/form is shown */}
      <div className={`${showingDetail ? 'hidden md:flex' : 'flex'} h-full w-full md:w-auto`}>
        <ContactList
          contacts={contacts}
          loading={loading}
          activeId={activeContact?.id ?? null}
          onSelect={handleSelect}
          onAdd={handleAdd}
          search={search}
          onSearchChange={setSearch}
        />
      </div>

      {view === 'new' || view === 'edit' ? (
        <div className="flex flex-1 items-start justify-center overflow-auto p-6">
          <ContactForm
            contact={view === 'edit' ? activeContact : null}
            onSave={handleFormSave}
            onCancel={handleFormCancel}
          />
        </div>
      ) : activeContact ? (
        <ContactDetail
          contact={activeContact}
          onEdit={handleEdit}
          onDelete={handleDelete}
          deleting={deleting}
          onBack={handleBack}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Users className="h-7 w-7 opacity-40" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Select a contact</p>
            <p className="mt-0.5 text-xs">Choose from the list to view details</p>
          </div>
        </div>
      )}
    </div>
  );
}
