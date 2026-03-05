import { useState, useEffect, useCallback } from 'react';
import { Users, Settings2, Tag, ListPlus, List, Upload, Download, GitMerge } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useContacts, type Contact, type ContactFilters } from '@/hooks/useContacts';
import { useContactTags } from '@/hooks/useContactTags';
import { useContactLists } from '@/hooks/useContactLists';
import { useCustomFieldDefinitions, type CustomFieldValue } from '@/hooks/useCustomFields';
import ContactList from '@/components/contacts/ContactList';
import ContactDetail from '@/components/contacts/ContactDetail';
import ContactForm from '@/components/contacts/ContactForm';
import TagsManager from '@/components/contacts/TagsManager';
import CustomFieldsManager from '@/components/contacts/CustomFieldsManager';
import ContactListsManager from '@/components/contacts/ContactListsManager';
import ImportWizard from '@/components/contacts/ImportWizard';
import DuplicateScanner from '@/components/contacts/DuplicateScanner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import PermissionGate from '@/components/auth/PermissionGate';

type View = 'detail' | 'new' | 'edit';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ContactFilters>({});
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [view, setView] = useState<View>('detail');
  const [deleting, setDeleting] = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValue[]>([]);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [fieldsDialogOpen, setFieldsDialogOpen] = useState(false);
  const [listsDialogOpen, setListsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [duplicateScannerOpen, setDuplicateScannerOpen] = useState(false);

  const { contacts, loading, refetch } = useContacts(search, filters);
  const { tags, loading: tagsLoading, createTag, updateTag, deleteTag } = useContactTags();
  const {
    lists,
    loading: listsLoading,
    refetch: refetchLists,
    createList,
    updateList,
    deleteList,
  } = useContactLists();
  const {
    definitions,
    loading: defsLoading,
    create: createDef,
    update: updateDef,
    remove: removeDef,
    reorder: reorderDefs,
  } = useCustomFieldDefinitions();

  // Sync activeListId into filters
  useEffect(() => {
    setFilters((prev) => {
      if (prev.listId === (activeListId || undefined)) return prev;
      return { ...prev, listId: activeListId || undefined };
    });
  }, [activeListId]);

  // Fetch custom field values when active contact changes
  const fetchCustomFieldValues = useCallback(async (contactId: string) => {
    try {
      const { data } = await api.get(`/contacts/${contactId}`);
      setCustomFieldValues(data.custom_field_values || []);
    } catch {
      setCustomFieldValues([]);
    }
  }, []);

  useEffect(() => {
    if (activeContact) {
      fetchCustomFieldValues(activeContact.id);
    } else {
      setCustomFieldValues([]);
    }
  }, [activeContact, fetchCustomFieldValues]);

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(contacts.map((c) => c.id));
  };

  const handleRangeSelect = (fromIndex: number, toIndex: number) => {
    const rangeIds = contacts.slice(fromIndex, toIndex + 1).map((c) => c.id);
    setSelectedIds((prev) => {
      const set = new Set(prev);
      rangeIds.forEach((id) => set.add(id));
      return Array.from(set);
    });
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const handleBulkActionComplete = () => {
    refetch();
    setSelectedIds([]);
  };

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
    if (activeContact && view === 'edit') {
      api.get(`/contacts/${activeContact.id}`).then(({ data }) => {
        setActiveContact(data.contact);
        setCustomFieldValues(data.custom_field_values || []);
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

  const handleCreateTagInline = async (name: string) => {
    await createTag(name, '#6B7280');
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedIds.length > 0) {
        params.set('contactIds', selectedIds.join(','));
      } else {
        if (search) params.set('search', search);
        if (filters.tags?.length) params.set('tags', filters.tags.join(','));
        if (filters.listId) params.set('listId', filters.listId);
        if (filters.city) params.set('city', filters.city);
        if (filters.country) params.set('country', filters.country);
        if (filters.company) params.set('company', filters.company);
        if (filters.customFields) {
          for (const [defId, value] of Object.entries(filters.customFields)) {
            if (value) params.set(`cf[${defId}]`, value);
          }
        }
      }
      const { data } = await api.get(`/contacts/export?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Contacts exported');
    } catch {
      toast.error('Failed to export contacts');
    }
  };

  const handleImportComplete = () => {
    refetch();
    setImportDialogOpen(false);
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
          filters={filters}
          onFiltersChange={setFilters}
          availableTags={tags}
          availableLists={lists}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onRangeSelect={handleRangeSelect}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onBulkActionComplete={handleBulkActionComplete}
          activeListId={activeListId}
          onSelectList={setActiveListId}
          customFieldDefinitions={definitions}
          headerActions={
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <PermissionGate resource="contact_tags" action="view">
                    <DropdownMenuItem onClick={() => setTagsDialogOpen(true)}>
                      <Tag className="mr-2 h-4 w-4" />
                      Manage Tags
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate resource="contact_lists" action="view">
                    <DropdownMenuItem onClick={() => setListsDialogOpen(true)}>
                      <List className="mr-2 h-4 w-4" />
                      Manage Lists
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate resource="custom_fields" action="view">
                    <DropdownMenuItem onClick={() => setFieldsDialogOpen(true)}>
                      <ListPlus className="mr-2 h-4 w-4" />
                      Manage Fields
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate resource="contacts" action="edit">
                    <DropdownMenuItem onClick={() => setDuplicateScannerOpen(true)}>
                      <GitMerge className="mr-2 h-4 w-4" />
                      Find Duplicates
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate resource="contacts" action="create">
                    <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
                      <Upload className="mr-2 h-4 w-4" />
                      Import Contacts
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate resource="contacts" action="view">
                    <DropdownMenuItem onClick={handleExport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export Contacts
                    </DropdownMenuItem>
                  </PermissionGate>
                </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </div>

      {view === 'new' || view === 'edit' ? (
        <div className="flex flex-1 items-start justify-center overflow-auto p-6">
          <ContactForm
            contact={view === 'edit' ? activeContact : null}
            onSave={handleFormSave}
            onCancel={handleFormCancel}
            availableTags={tags}
            customFieldDefinitions={definitions}
            existingCustomFieldValues={view === 'edit' ? customFieldValues : []}
            onCreateTag={handleCreateTagInline}
          />
        </div>
      ) : activeContact ? (
        <ContactDetail
          contact={activeContact}
          onEdit={handleEdit}
          onDelete={handleDelete}
          deleting={deleting}
          onBack={handleBack}
          availableTags={tags}
          customFieldValues={customFieldValues}
          onRefresh={() => { refetch(); if (activeContact) fetchCustomFieldValues(activeContact.id); }}
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

      {/* Tags Manager Dialog */}
      <Dialog open={tagsDialogOpen} onOpenChange={setTagsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contact Tags</DialogTitle>
          </DialogHeader>
          <TagsManager
            tags={tags}
            loading={tagsLoading}
            onCreateTag={createTag}
            onUpdateTag={updateTag}
            onDeleteTag={deleteTag}
          />
        </DialogContent>
      </Dialog>

      {/* Contact Lists Manager Dialog */}
      <Dialog open={listsDialogOpen} onOpenChange={setListsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contact Lists</DialogTitle>
          </DialogHeader>
          <ContactListsManager
            lists={lists}
            loading={listsLoading}
            onCreateList={createList}
            onUpdateList={updateList}
            onDeleteList={deleteList}
          />
        </DialogContent>
      </Dialog>

      {/* Custom Fields Manager Dialog */}
      <Dialog open={fieldsDialogOpen} onOpenChange={setFieldsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Custom Fields</DialogTitle>
          </DialogHeader>
          <CustomFieldsManager
            definitions={definitions}
            loading={defsLoading}
            onCreate={createDef}
            onUpdate={updateDef}
            onRemove={removeDef}
            onReorder={reorderDefs}
          />
        </DialogContent>
      </Dialog>

      {/* Duplicate Scanner */}
      <DuplicateScanner
        open={duplicateScannerOpen}
        onOpenChange={setDuplicateScannerOpen}
        onMergeComplete={refetch}
      />

      {/* Import Wizard */}
      <ImportWizard
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onComplete={handleImportComplete}
        availableTags={tags}
        availableLists={lists}
        customFieldDefinitions={definitions}
      />
    </div>
  );
}
