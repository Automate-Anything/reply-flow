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
    try {
      await api.delete(`/contacts/${activeContact.id}`);
      setActiveContact(null);
      setView('detail');
      refetch();
      toast.success('Contact deleted');
    } catch {
      toast.error('Failed to delete contact');
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
          onBack={handleBack}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <Users className="h-12 w-12 opacity-20" />
          <p className="text-sm">Select a contact to view details</p>
        </div>
      )}
    </div>
  );
}
