import { cn } from '@/lib/utils';
import type { ContactList } from '@/hooks/useContactLists';

interface ContactListSelectorProps {
  lists: ContactList[];
  activeListId: string | null;
  onSelectList: (listId: string | null) => void;
}

export default function ContactListSelector({
  lists,
  activeListId,
  onSelectList,
}: ContactListSelectorProps) {
  if (lists.length === 0) return null;

  return (
    <div className="flex gap-1 overflow-x-auto border-b px-3 py-1.5">
      <button
        onClick={() => onSelectList(null)}
        className={cn(
          'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs transition-colors',
          activeListId === null
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'
        )}
      >
        All
      </button>
      {lists.map((list) => (
        <button
          key={list.id}
          onClick={() => onSelectList(list.id)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition-colors',
            activeListId === list.id
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          )}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: list.color }}
          />
          {list.name}
        </button>
      ))}
    </div>
  );
}
