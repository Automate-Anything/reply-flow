import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckSquare, MessageSquare, Search } from 'lucide-react';
import ConversationItem from './ConversationItem';
import ConversationFiltersBar from './ConversationFilters';
import BulkActionBar from './BulkActionBar';
import type { Conversation, ConversationFilters } from '@/hooks/useConversations';
import type { TeamMember } from '@/hooks/useTeamMembers';

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  loading: boolean;
  activeId: string | null;
  onSelect: (conversation: Conversation) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filters: ConversationFilters;
  onFiltersChange: (filters: ConversationFilters) => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkActionComplete: () => void;
  teamMembers: TeamMember[];
  labels: LabelOption[];
}

export default function ConversationList({
  conversations,
  loading,
  activeId,
  onSelect,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  selectionMode,
  onToggleSelectionMode,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkActionComplete,
  teamMembers,
  labels,
}: ConversationListProps) {
  return (
    <div className="flex h-full w-full flex-col border-r md:w-[320px]">
      <div className="border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              className="pl-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <Button
            variant={selectionMode ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={onToggleSelectionMode}
            title={selectionMode ? 'Exit selection' : 'Select conversations'}
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConversationFiltersBar filters={filters} onFiltersChange={onFiltersChange} />

      {selectionMode && conversations.length > 0 && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <Checkbox
            checked={selectedIds.length === conversations.length && conversations.length > 0}
            onCheckedChange={(checked) => {
              if (checked) onSelectAll();
              else onClearSelection();
            }}
          />
          <span className="text-xs text-muted-foreground">
            {selectedIds.length === conversations.length ? 'Deselect all' : 'Select all'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-muted-foreground">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-7 w-7 opacity-40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {search ? 'No results found' : 'No conversations yet'}
              </p>
              <p className="mt-0.5 text-xs">
                {search
                  ? 'Try a different search term'
                  : 'Conversations will appear here when you receive messages'}
              </p>
            </div>
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeId}
              onClick={() => onSelect(conv)}
              selectable={selectionMode}
              selected={selectedIds.includes(conv.id)}
              onToggleSelect={() => onToggleSelect(conv.id)}
            />
          ))
        )}
      </div>

      {selectionMode && selectedIds.length > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          onClearSelection={onClearSelection}
          onActionComplete={onBulkActionComplete}
          teamMembers={teamMembers}
          labels={labels}
        />
      )}
    </div>
  );
}
