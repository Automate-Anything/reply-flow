import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ArrowDownUp, CircleDot, Filter, Flag, Mail, Star, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationFilters as FilterState } from '@/hooks/useConversations';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';

interface ConversationFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  statuses?: ConversationStatus[];
}

export default function ConversationFilters({
  filters,
  onFiltersChange,
  statuses = [],
}: ConversationFiltersProps) {
  const updateFilter = (key: keyof FilterState, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const isStatusActive = filters.status && filters.status !== 'all';
  const isAssigneeActive = filters.assignee && filters.assignee !== 'all';
  const isPriorityActive = filters.priority && filters.priority !== 'all';

  const activeFilterCount = [
    isStatusActive,
    isAssigneeActive,
    isPriorityActive,
    filters.starred,
    filters.snoozed,
    filters.unread,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={hasActiveFilters ? 'secondary' : 'ghost'}
            size="icon"
            className="relative h-9 w-9 shrink-0"
            title="Filters"
          >
            <Filter className="h-4 w-4" />
            {hasActiveFilters && (
              <Badge className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Filters</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
                onClick={() => onFiltersChange({})}
              >
                Clear all
              </Button>
            )}
          </div>

          <div className="mt-3 space-y-2.5">
            <FilterRow
              icon={<CircleDot className="h-3.5 w-3.5" />}
              label="Status"
              active={!!isStatusActive}
            >
              <Select
                value={filters.status || 'all'}
                onValueChange={(v) => updateFilter('status', v)}
              >
                <SelectTrigger className="h-7 w-full border-transparent bg-muted/60 px-2 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {statuses.length > 0
                    ? statuses.map((s) => (
                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                      ))
                    : <>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </>
                  }
                  <SelectItem value="snoozed">Snoozed</SelectItem>
                </SelectContent>
              </Select>
            </FilterRow>

            <FilterRow
              icon={<User className="h-3.5 w-3.5" />}
              label="Assignee"
              active={!!isAssigneeActive}
            >
              <Select
                value={filters.assignee || 'all'}
                onValueChange={(v) => updateFilter('assignee', v)}
              >
                <SelectTrigger className="h-7 w-full border-transparent bg-muted/60 px-2 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="me">Mine</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </FilterRow>

            <FilterRow
              icon={<Flag className="h-3.5 w-3.5" />}
              label="Priority"
              active={!!isPriorityActive}
            >
              <Select
                value={filters.priority || 'all'}
                onValueChange={(v) => updateFilter('priority', v)}
              >
                <SelectTrigger className="h-7 w-full border-transparent bg-muted/60 px-2 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </FilterRow>

            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-2">
                <Star className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs">Starred only</span>
              </div>
              <Button
                variant={filters.starred ? 'secondary' : 'ghost'}
                size="icon"
                className={cn(
                  'h-6 w-6 rounded-full',
                  filters.starred &&
                    'bg-yellow-50 text-yellow-500 hover:bg-yellow-100 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/20'
                )}
                onClick={() => updateFilter('starred', !filters.starred)}
              >
                <Star
                  className={cn('h-3 w-3', filters.starred && 'fill-current')}
                />
              </Button>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs">Unread only</span>
              </div>
              <Button
                variant={filters.unread ? 'secondary' : 'ghost'}
                size="icon"
                className={cn(
                  'h-6 w-6 rounded-full',
                  filters.unread &&
                    'bg-blue-50 text-blue-500 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20'
                )}
                onClick={() => updateFilter('unread', !filters.unread)}
              >
                <Mail
                  className={cn('h-3 w-3', filters.unread && 'fill-current')}
                />
              </Button>
            </div>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Sort</span>
              <Select
                value={filters.sort || 'newest'}
                onValueChange={(v) => updateFilter('sort', v as 'newest' | 'oldest')}
              >
                <SelectTrigger className="ml-auto h-7 w-auto border-transparent bg-muted/60 px-2 text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterRow({
  icon,
  label,
  active,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</div>
      <span className={cn('w-16 shrink-0 text-xs', active && 'font-medium text-primary')}>
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
