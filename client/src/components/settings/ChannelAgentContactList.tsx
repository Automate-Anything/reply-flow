import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { Search, UserPlus, X } from 'lucide-react';

interface ContactOption {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  whatsapp_name?: string | null;
}

interface Props {
  title: string;
  description: string;
  selectedIds: string[];
  emptyLabel: string;
  onChange: (ids: string[]) => Promise<void>;
}

function getContactName(contact: ContactOption): string {
  return (
    [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
    contact.whatsapp_name ||
    contact.phone_number
  );
}

export default function ChannelAgentContactList({
  title,
  description,
  selectedIds,
  emptyLabel,
  onChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<ContactOption[]>([]);
  const [results, setResults] = useState<ContactOption[]>([]);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (selectedIds.length === 0) {
      setSelectedContacts([]);
      return;
    }

    setLoadingSelected(true);
    void api.get(`/contacts?ids=${selectedIds.join(',')}&limit=${selectedIds.length}`)
      .then(({ data }) => {
        if (!cancelled) {
          setSelectedContacts(data.contacts || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedContacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSelected(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedIds]);

  // Only search when there's input
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      setLoadingResults(true);
      void api.get(`/contacts?search=${encodeURIComponent(search)}&limit=12`)
        .then(({ data }) => {
          if (!cancelled) {
            setResults(data.contacts || []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingResults(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search]);

  const availableResults = useMemo(
    () => results.filter((contact) => !selectedIds.includes(contact.id)).slice(0, 3),
    [results, selectedIds]
  );

  const handleAdd = async (contactId: string) => {
    setSavingId(contactId);
    try {
      await onChange([...selectedIds, contactId]);
      setSearch('');
      setDropdownOpen(false);
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (contactId: string) => {
    setSavingId(contactId);
    try {
      await onChange(selectedIds.filter((id) => id !== contactId));
    } finally {
      setSavingId(null);
    }
  };

  const showDropdown = dropdownOpen && search.trim().length > 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div ref={containerRef} className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => { if (search.trim()) setDropdownOpen(true); }}
          placeholder="Search contacts..."
          className="pl-9"
        />

        {showDropdown && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {loadingResults ? (
                <div className="space-y-1 p-1">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : availableResults.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  No matching contacts
                </p>
              ) : (
                availableResults.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left hover:bg-accent"
                    onClick={() => handleAdd(contact.id)}
                    disabled={savingId === contact.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{getContactName(contact)}</p>
                      <p className="truncate text-xs text-muted-foreground">{contact.phone_number}</p>
                    </div>
                    <UserPlus className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {loadingSelected ? (
        <Skeleton className="h-8 w-full" />
      ) : selectedContacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {selectedContacts.map((contact) => (
            <Badge key={contact.id} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
              <span className="max-w-44 truncate">{getContactName(contact)}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => handleRemove(contact.id)}
                disabled={savingId === contact.id}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
