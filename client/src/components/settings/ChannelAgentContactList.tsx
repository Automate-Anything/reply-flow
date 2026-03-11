import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { ChevronDown, ChevronUp, Loader2, Search, UserPlus, X } from 'lucide-react';

interface ContactOption {
  id: string;
  phone_number: string;
  first_name: string | null;
  last_name: string | null;
  whatsapp_name?: string | null;
}

interface Props {
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
  const [pendingAddedContact, setPendingAddedContact] = useState<ContactOption | null>(null);
  const [pendingRemovedContactIds, setPendingRemovedContactIds] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAllSelected, setShowAllSelected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedContainerRef = useRef<HTMLDivElement>(null);
  const [hasHiddenSelectedContacts, setHasHiddenSelectedContacts] = useState(false);

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

  useEffect(() => {
    if (pendingAddedContact && selectedContacts.some((contact) => contact.id === pendingAddedContact.id)) {
      setPendingAddedContact(null);
    }
  }, [pendingAddedContact, selectedContacts]);

  useEffect(() => {
    if (pendingRemovedContactIds.length === 0) return;
    setPendingRemovedContactIds((current) =>
      current.filter((id) => selectedContacts.some((contact) => contact.id === id))
    );
  }, [pendingRemovedContactIds, selectedContacts]);

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
    const contact = results.find((entry) => entry.id === contactId) ?? null;
    setSavingId(contactId);
    setPendingAddedContact(contact);
    setDropdownOpen(false);
    setSearch('');
    try {
      await onChange([...selectedIds, contactId]);
    } catch (error) {
      setPendingAddedContact(null);
      throw error;
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (contactId: string) => {
    setSavingId(contactId);
    setPendingRemovedContactIds((current) => [...current, contactId]);
    try {
      await onChange(selectedIds.filter((id) => id !== contactId));
    } catch (error) {
      setPendingRemovedContactIds((current) => current.filter((id) => id !== contactId));
      throw error;
    } finally {
      setSavingId(null);
    }
  };

  const showDropdown = dropdownOpen && search.trim().length > 0;
  const visibleSelectedContacts = selectedContacts.filter(
    (contact) => !pendingRemovedContactIds.includes(contact.id)
  );
  const displayedContacts = pendingAddedContact && !visibleSelectedContacts.some((contact) => contact.id === pendingAddedContact.id)
    ? [...visibleSelectedContacts, pendingAddedContact]
    : visibleSelectedContacts;
  const shouldClampSelected = displayedContacts.length > 4 && !showAllSelected;
  const isMutatingSelection = savingId !== null || pendingAddedContact !== null || pendingRemovedContactIds.length > 0;

  useEffect(() => {
    const node = selectedContainerRef.current;
    if (!node) {
      setHasHiddenSelectedContacts(false);
      return;
    }

    const measure = () => {
      setHasHiddenSelectedContacts(node.scrollHeight > node.clientHeight + 1);
    };

    measure();
    const timeout = window.setTimeout(measure, 0);
    window.addEventListener('resize', measure);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('resize', measure);
    };
  }, [displayedContacts, shouldClampSelected, showAllSelected]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{description}</p>

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
                    className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-0"
                    onMouseDown={(e) => e.preventDefault()}
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

      {loadingSelected && displayedContacts.length === 0 && !isMutatingSelection ? (
        <Skeleton className="h-8 w-full" />
      ) : displayedContacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          <div
            ref={selectedContainerRef}
            className={shouldClampSelected ? 'max-h-[4.5rem] overflow-hidden' : ''}
          >
            <div className="flex flex-wrap gap-2">
              {displayedContacts.map((contact) => {
                const isPendingAdd = pendingAddedContact?.id === contact.id;
                return (
                  <Badge key={contact.id} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
                    <span className="max-w-44 truncate">{getContactName(contact)}</span>
                    {isPendingAdd && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => handleRemove(contact.id)}
                      disabled={savingId === contact.id || isPendingAdd}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>

          {hasHiddenSelectedContacts && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowAllSelected((prev) => !prev)}
            >
              {showAllSelected ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Collapse contact list
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Show all contacts ({displayedContacts.length})
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
