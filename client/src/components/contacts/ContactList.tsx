import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Plus, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Contact } from '@/hooks/useContacts';

interface ContactListProps {
  contacts: Contact[];
  loading: boolean;
  activeId: string | null;
  onSelect: (contact: Contact) => void;
  onAdd: () => void;
  search: string;
  onSearchChange: (value: string) => void;
}

export default function ContactList({
  contacts,
  loading,
  activeId,
  onSelect,
  onAdd,
  search,
  onSearchChange,
}: ContactListProps) {
  return (
    <div className="flex h-full w-full flex-col border-r md:w-[320px]">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={onAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

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
          contacts.map((contact) => {
            const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
              || contact.whatsapp_name
              || contact.phone_number;

            return (
              <button
                key={contact.id}
                onClick={() => onSelect(contact)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                  'hover:bg-accent',
                  activeId === contact.id && 'bg-accent'
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {(contact.first_name?.[0] || contact.phone_number[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.phone_number}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
