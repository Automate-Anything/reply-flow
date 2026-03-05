import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Search, Plus, User, ArrowDownUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Contact, ContactFilters as FilterState } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { ContactList as ContactListType } from '@/hooks/useContactLists';
import type { CustomFieldDefinition } from '@/hooks/useCustomFields';
import ContactFilters from './ContactFilters';
import ContactListSelector from './ContactListSelector';
import ContactBulkActionBar from './ContactBulkActionBar';
import ContactContextMenu from './ContactContextMenu';

interface ContactListProps {
  contacts: Contact[];
  loading: boolean;
  activeId: string | null;
  onSelect: (contact: Contact) => void;
  onAdd: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  headerActions?: React.ReactNode;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  availableTags: ContactTag[];
  availableLists: ContactListType[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRangeSelect: (fromIndex: number, toIndex: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkActionComplete: () => void;
  activeListId: string | null;
  onSelectList: (listId: string | null) => void;
  customFieldDefinitions?: CustomFieldDefinition[];
  onEditContact?: (contact: Contact) => void;
  onRefresh?: () => void;
}

export default function ContactList({
  contacts,
  loading,
  activeId,
  onSelect,
  onAdd,
  search,
  onSearchChange,
  headerActions,
  filters,
  onFiltersChange,
  availableTags,
  availableLists,
  selectedIds,
  onToggleSelect,
  onRangeSelect,
  onSelectAll,
  onClearSelection,
  onBulkActionComplete,
  activeListId,
  onSelectList,
  customFieldDefinitions,
  onEditContact,
  onRefresh,
}: ContactListProps) {
  const lastClickedIndex = useRef<number | null>(null);
  const hasSelection = selectedIds.length > 0;

  const handleItemClick = (contact: Contact, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex.current !== null) {
      // Shift+click: range select
      e.preventDefault();
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      onRangeSelect(from, to);
    } else if (hasSelection) {
      // Already selecting: toggle this item
      onToggleSelect(contact.id);
      lastClickedIndex.current = index;
    } else {
      // Normal click: open detail
      onSelect(contact);
    }
  };

  const handleCheckboxChange = (contact: Contact, index: number) => {
    onToggleSelect(contact.id);
    lastClickedIndex.current = index;
  };

  const isDateSort = !filters.sortBy || filters.sortBy === 'updated_at' || filters.sortBy === 'created_at';

  return (
    <div className="flex h-full w-full flex-col border-r md:w-[320px]">
      {/* Row 1: Search */}
      <div className="border-b px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Row 2: Filter + Sort + Settings + Add */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <ContactFilters
          filters={filters}
          onFiltersChange={onFiltersChange}
          availableTags={availableTags}
          availableLists={availableLists}
          customFieldDefinitions={customFieldDefinitions}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="Sort"
            >
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-2">
            <span className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Sort by
            </span>
            <div className="mt-1 space-y-0.5">
              {([
                ['updated_at', 'Updated'],
                ['created_at', 'Created'],
                ['name', 'Name'],
                ['company', 'Company'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={cn(
                    'flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent',
                    (filters.sortBy || 'updated_at') === value && 'bg-accent font-medium'
                  )}
                  onClick={() => onFiltersChange({ ...filters, sortBy: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 border-t pt-2">
              <span className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Order
              </span>
              <div className="mt-1 space-y-0.5">
                {(isDateSort
                  ? ([['desc', 'Newest first'], ['asc', 'Oldest first']] as const)
                  : ([['asc', 'A → Z'], ['desc', 'Z → A']] as const)
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={cn(
                      'flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent',
                      (filters.sortOrder || 'desc') === value && 'bg-accent font-medium'
                    )}
                    onClick={() => onFiltersChange({ ...filters, sortOrder: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {headerActions}
        <div className="flex-1" />
        <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={onAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ContactListSelector
        lists={availableLists}
        activeListId={activeListId}
        onSelectList={onSelectList}
      />

      {/* Select all bar — shown when any items are selected */}
      {hasSelection && contacts.length > 0 && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <Checkbox
            checked={selectedIds.length === contacts.length && contacts.length > 0}
            onCheckedChange={(checked) => {
              if (checked) onSelectAll();
              else onClearSelection();
            }}
          />
          <span className="text-xs text-muted-foreground">
            {selectedIds.length === contacts.length ? 'Deselect all' : 'Select all'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md p-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <User className="h-8 w-8 opacity-20" />
            {search ? 'No contacts match your search' : 'No contacts yet'}
          </div>
        ) : (
          contacts.map((contact, index) => {
            const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
              || contact.whatsapp_name
              || contact.phone_number;
            const isSelected = selectedIds.includes(contact.id);

            const item = (
              <button
                key={contact.id}
                onClick={(e) => handleItemClick(contact, index, e)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                  'hover:bg-accent',
                  activeId === contact.id && !hasSelection && 'bg-accent',
                  isSelected && 'bg-accent'
                )}
              >
                {/* Checkbox — always takes space, fades in on hover */}
                <div
                  className={cn(
                    'flex w-5 shrink-0 items-center justify-center transition-opacity duration-300 ease-in-out',
                    hasSelection
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleCheckboxChange(contact, index)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                {/* Avatar */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {(contact.first_name?.[0] || contact.phone_number[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.phone_number}</p>
                </div>
              </button>
            );

            if (onEditContact && onRefresh) {
              return (
                <ContactContextMenu
                  key={contact.id}
                  contact={contact}
                  availableTags={availableTags}
                  availableLists={availableLists}
                  onEdit={onEditContact}
                  onRefresh={onRefresh}
                >
                  {item}
                </ContactContextMenu>
              );
            }

            return item;
          })
        )}
      </div>

      {/* Bulk Action Bar */}
      {hasSelection && (
        <ContactBulkActionBar
          selectedIds={selectedIds}
          onClearSelection={onClearSelection}
          onActionComplete={onBulkActionComplete}
          availableTags={availableTags}
          availableLists={availableLists}
        />
      )}
    </div>
  );
}
