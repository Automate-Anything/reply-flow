import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationFilters as FilterState } from '@/hooks/useConversations';

interface ConversationFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export default function ConversationFilters({
  filters,
  onFiltersChange,
}: ConversationFiltersProps) {
  const updateFilter = (key: keyof FilterState, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    (filters.status && filters.status !== 'all') ||
    (filters.assignee && filters.assignee !== 'all') ||
    (filters.priority && filters.priority !== 'all') ||
    filters.starred ||
    filters.snoozed;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      <Select
        value={filters.status || 'all'}
        onValueChange={(v) => updateFilter('status', v)}
      >
        <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
          <SelectItem value="snoozed">Snoozed</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.assignee || 'all'}
        onValueChange={(v) => updateFilter('assignee', v)}
      >
        <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Assignees</SelectItem>
          <SelectItem value="me">Assigned to Me</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.priority || 'all'}
        onValueChange={(v) => updateFilter('priority', v)}
      >
        <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priority</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant={filters.starred ? 'secondary' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={() => updateFilter('starred', !filters.starred)}
        title="Show starred only"
      >
        <Star
          className={cn('h-3.5 w-3.5', filters.starred && 'fill-yellow-400 text-yellow-400')}
        />
      </Button>

      <Select
        value={filters.sort || 'newest'}
        onValueChange={(v) => updateFilter('sort', v as 'newest' | 'oldest')}
      >
        <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="oldest">Oldest</SelectItem>
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() =>
            onFiltersChange({})
          }
        >
          Clear
        </Button>
      )}
    </div>
  );
}
