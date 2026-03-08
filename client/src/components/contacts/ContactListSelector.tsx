import { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(lists.length);
  const [measured, setMeasured] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const children = Array.from(container.children) as HTMLElement[];
    if (children.length === 0) return;

    // Available width = container width minus padding (px-3 = 12px each side) minus room for "+N" button (~64px)
    const containerWidth = container.offsetWidth;
    const gap = 4; // gap-1 = 4px
    const moreButtonWidth = 72;

    let usedWidth = 0;
    let count = 0;

    for (const child of children) {
      // Skip the "+N more" button itself during measurement
      if (child.dataset.more) break;

      const childWidth = child.scrollWidth;
      const nextWidth = usedWidth + (count > 0 ? gap : 0) + childWidth;

      // Check if this item fits, leaving room for "+N more" if there are more items after
      const isLast = count === lists.length; // +1 for the "All" button
      if (!isLast && nextWidth + gap + moreButtonWidth > containerWidth) break;
      if (isLast && nextWidth > containerWidth) break;

      usedWidth = nextWidth;
      count++;
    }

    // count includes the "All" button, so visible list items = count - 1
    const visibleLists = Math.max(0, count - 1);
    setVisibleCount(visibleLists);
    setMeasured(true);
  }, [lists.length]);

  useEffect(() => {
    setMeasured(false);
    setVisibleCount(lists.length);
  }, [lists.length]);

  useEffect(() => {
    measure();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setMeasured(false);
      setVisibleCount(lists.length);
      // Re-measure on next frame after reset
      requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, lists.length]);

  if (lists.length === 0) return null;

  const visibleLists = lists.slice(0, visibleCount);
  const overflowLists = lists.slice(visibleCount);
  // If the active list is in the overflow, always show it
  const activeInOverflow = overflowLists.find((l) => l.id === activeListId);

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 border-b px-3 py-1.5"
      style={!measured ? { visibility: 'hidden' } : undefined}
    >
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
      {visibleLists.map((list) => (
        <ListPill
          key={list.id}
          list={list}
          isActive={activeListId === list.id}
          onClick={() => onSelectList(list.id)}
        />
      ))}
      {activeInOverflow && (
        <ListPill
          key={activeInOverflow.id}
          list={activeInOverflow}
          isActive
          onClick={() => onSelectList(activeInOverflow.id)}
        />
      )}
      {overflowLists.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-more="true"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            >
              +{activeInOverflow ? overflowLists.length - 1 : overflowLists.length} more
              <ChevronDown className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            {overflowLists
              .filter((l) => l.id !== activeListId)
              .map((list) => (
                <button
                  key={list.id}
                  onClick={() => onSelectList(list.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: list.color }}
                  />
                  {list.name}
                </button>
              ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function ListPill({
  list,
  isActive,
  onClick,
}: {
  list: ContactList;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition-colors',
        isActive
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
  );
}
