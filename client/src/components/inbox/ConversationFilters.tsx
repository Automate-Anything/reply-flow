import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ArrowDownUp, ChevronRight, CircleDot, Filter, Flag, Mail, Star, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationFilters as FilterState } from '@/hooks/useConversations';
import type { ConversationStatus } from '@/hooks/useConversationStatuses';
import type { ConversationPriority } from '@/hooks/useConversationPriorities';

interface ConversationFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  statuses?: ConversationStatus[];
  priorities?: ConversationPriority[];
  onPriorityMetadataNeeded?: () => void;
}

function toggleMultiValue(values: string[] | undefined, value: string): string[] | undefined {
  const current = values || [];
  if (value === 'all') return undefined;
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return next.length > 0 ? next : undefined;
}

function getSummary(values: string[] | undefined, labels: Record<string, string>) {
  if (!values || values.length === 0) return '';
  if (values.length === 1) return labels[values[0]] || values[0];
  return `${values.length} selected`;
}

export default function ConversationFilters({
  filters,
  onFiltersChange,
  statuses = [],
  priorities = [],
  onPriorityMetadataNeeded,
}: ConversationFiltersProps) {
  const updateFilter = (key: keyof FilterState, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const statusValues = filters.status || [];
  const assigneeValues = filters.assignee || [];
  const priorityValues = filters.priority || [];

  const statusLabels = Object.fromEntries(
    (statuses.length > 0
      ? statuses.map((status) => [status.name, status.name])
      : [['open', 'Open'], ['pending', 'Pending'], ['resolved', 'Resolved'], ['closed', 'Closed']]
    ).concat([['snoozed', 'Snoozed']])
  );
  const assigneeLabels: Record<string, string> = {
    me: 'Mine',
    others: 'Others',
    unassigned: 'Unassigned',
  };
  const priorityLabels = Object.fromEntries(priorities.map((priority) => [priority.name, priority.name]));

  const isStatusActive = statusValues.length > 0;
  const isAssigneeActive = assigneeValues.length > 0;
  const isPriorityActive = priorityValues.length > 0;

  const activeFilterCount = [
    isStatusActive,
    isAssigneeActive,
    isPriorityActive,
    filters.starred,
    filters.snoozed,
    filters.unread,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const statusOptions = statuses.length > 0
    ? statuses.map((status) => ({ value: status.name, label: status.name }))
    : [
        { value: 'open', label: 'Open' },
        { value: 'pending', label: 'Pending' },
        { value: 'resolved', label: 'Resolved' },
        { value: 'closed', label: 'Closed' },
      ];
  const priorityOptions = priorities.length > 0
    ? priorities.map((priority) => ({ value: priority.name, label: priority.name, color: priority.color }))
    : [
        { value: 'Urgent', label: 'Urgent', color: '#EF4444' },
        { value: 'High', label: 'High', color: '#F97316' },
        { value: 'Medium', label: 'Medium', color: '#EAB308' },
        { value: 'Low', label: 'Low', color: '#3B82F6' },
        { value: 'None', label: 'None', color: '#9CA3AF' },
      ];

  return (
    <div className="flex items-center gap-1.5">
      <Popover onOpenChange={(open) => { if (open) onPriorityMetadataNeeded?.(); }}>
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
        <PopoverContent align="start" className="w-72 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Filters</span>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
                onClick={() => onFiltersChange({ sort: filters.sort })}
              >
                Clear all
              </Button>
            )}
          </div>

          <Accordion
            type="multiple"
            className="mt-3 space-y-3"
          >
            <FilterSection
              value="status"
              icon={<CircleDot className="h-3.5 w-3.5" />}
              label="Status"
              active={isStatusActive}
              summary={getSummary(statusValues, statusLabels)}
            >
              {statusOptions.map((status) => (
                <MultiSelectRow
                  key={status.value}
                  label={status.label}
                  checked={statusValues.includes(status.value)}
                  onCheckedChange={() => updateFilter('status', toggleMultiValue(filters.status, status.value))}
                />
              ))}
            </FilterSection>

            <FilterSection
              value="assignee"
              icon={<User className="h-3.5 w-3.5" />}
              label="Assignee"
              active={isAssigneeActive}
              summary={getSummary(assigneeValues, assigneeLabels)}
            >
              <MultiSelectRow
                label="Mine"
                checked={assigneeValues.includes('me')}
                onCheckedChange={() => updateFilter('assignee', toggleMultiValue(filters.assignee, 'me'))}
              />
              <MultiSelectRow
                label="Others"
                checked={assigneeValues.includes('others')}
                onCheckedChange={() => updateFilter('assignee', toggleMultiValue(filters.assignee, 'others'))}
              />
              <MultiSelectRow
                label="Unassigned"
                checked={assigneeValues.includes('unassigned')}
                onCheckedChange={() => updateFilter('assignee', toggleMultiValue(filters.assignee, 'unassigned'))}
              />
            </FilterSection>

            <FilterSection
              value="priority"
              icon={<Flag className="h-3.5 w-3.5" />}
              label="Priority"
              active={isPriorityActive}
              summary={getSummary(priorityValues, priorityLabels)}
            >
              {priorityOptions.map((priority) => (
                <MultiSelectRow
                  key={priority.value}
                  label={priority.label}
                  checked={priorityValues.includes(priority.value)}
                  onCheckedChange={() => updateFilter('priority', toggleMultiValue(filters.priority, priority.value))}
                  leading={
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: priority.color }}
                    />
                  }
                />
              ))}
            </FilterSection>
          </Accordion>

          <div className="mt-3 space-y-3">
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
                <Star className={cn('h-3 w-3', filters.starred && 'fill-current')} />
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
                <Mail className={cn('h-3 w-3', filters.unread && 'fill-current')} />
              </Button>
            </div>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Sort</span>
              <div className="ml-auto flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
                <Button
                  variant={filters.sort !== 'oldest' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => updateFilter('sort', 'newest')}
                >
                  Newest
                </Button>
                <Button
                  variant={filters.sort === 'oldest' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => updateFilter('sort', 'oldest')}
                >
                  Oldest
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterSection({
  value,
  icon,
  label,
  active,
  summary,
  children,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(active);

  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="py-2.5">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</div>
            <span className={cn('text-xs', active && 'font-medium text-primary')}>{label}</span>
          </div>
          <span className="truncate text-[11px] text-muted-foreground">{summary}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-1">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function MultiSelectRow({
  label,
  checked,
  onCheckedChange,
  leading,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onCheckedChange}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/70"
    >
      <Checkbox checked={checked} />
      {leading}
      <span className="text-xs">{label}</span>
    </button>
  );
}
