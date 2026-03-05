import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { List, Loader2, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ContactTag } from '@/hooks/useContactTags';
import type { ContactList } from '@/hooks/useContactLists';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import PermissionGate from '@/components/auth/PermissionGate';

interface ContactBulkActionBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onActionComplete: () => void;
  availableTags: ContactTag[];
  availableLists: ContactList[];
}

export default function ContactBulkActionBar({
  selectedIds,
  onClearSelection,
  onActionComplete,
  availableTags,
  availableLists,
}: ContactBulkActionBarProps) {
  const [loading, setLoading] = useState(false);

  const executeBulk = async (action: string, value?: unknown) => {
    setLoading(true);
    try {
      await api.post('/contacts/bulk', { contactIds: selectedIds, action, value });
      onActionComplete();
      onClearSelection();
      toast.success(`Updated ${selectedIds.length} contact${selectedIds.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Bulk action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1 border-t bg-background px-3 py-2">
      <span className="mr-1 text-xs font-medium text-muted-foreground">
        {selectedIds.length} selected
      </span>

      {/* Tag */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="Tag">
            <Tag className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add tag</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {availableTags.map((tag) => (
                <DropdownMenuItem key={tag.id} onClick={() => executeBulk('tag_add', tag.name)}>
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </DropdownMenuItem>
              ))}
              {availableTags.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No tags</div>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Remove tag</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {availableTags.map((tag) => (
                <DropdownMenuItem key={tag.id} onClick={() => executeBulk('tag_remove', tag.name)}>
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </DropdownMenuItem>
              ))}
              {availableTags.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No tags</div>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* List */}
      {availableLists.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading} title="List">
              <List className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Add to list</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {availableLists.map((list) => (
                  <DropdownMenuItem key={list.id} onClick={() => executeBulk('list_add', list.id)}>
                    <span
                      className="mr-2 h-2 w-2 rounded-full"
                      style={{ backgroundColor: list.color }}
                    />
                    {list.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Remove from list</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {availableLists.map((list) => (
                  <DropdownMenuItem key={list.id} onClick={() => executeBulk('list_remove', list.id)}>
                    <span
                      className="mr-2 h-2 w-2 rounded-full"
                      style={{ backgroundColor: list.color }}
                    />
                    {list.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Delete */}
      <PermissionGate resource="contacts" action="delete">
        <ConfirmDialog
          title={`Delete ${selectedIds.length} contact${selectedIds.length === 1 ? '' : 's'}?`}
          description="This will permanently delete the selected contacts and all associated data."
          onConfirm={() => executeBulk('delete')}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            disabled={loading}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </ConfirmDialog>
      </PermissionGate>

      {loading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onClearSelection}
        title="Clear selection"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
