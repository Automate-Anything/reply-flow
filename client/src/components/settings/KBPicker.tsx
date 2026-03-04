import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BookOpen, Plus, X, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KBAttachment } from '@/hooks/useCompanyAI';
import type { KnowledgeBase } from '@/hooks/useCompanyKB';

interface KBPickerProps {
  value: KBAttachment[];
  onChange: (next: KBAttachment[]) => void;
  knowledgeBases: KnowledgeBase[];
  description?: string;
  createHref?: string;
  disabled?: boolean;
}

export default function KBPicker({
  value,
  onChange,
  knowledgeBases,
  description,
  createHref,
  disabled,
}: KBPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const assignedIds = new Set(value.map((a) => a.kb_id));

  const filtered = knowledgeBases.filter((kb) =>
    kb.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleExpanded = (kbId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(kbId)) next.delete(kbId);
      else next.add(kbId);
      return next;
    });
  };

  const handleToggle = (kbId: string) => {
    if (assignedIds.has(kbId)) {
      onChange(value.filter((a) => a.kb_id !== kbId));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(kbId);
        return next;
      });
    } else {
      onChange([...value, { kb_id: kbId }]);
    }
  };

  const handleRemove = (kbId: string) => {
    onChange(value.filter((a) => a.kb_id !== kbId));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(kbId);
      return next;
    });
  };

  const handleInstructionsChange = (kbId: string, instructions: string) => {
    onChange(
      value.map((a) =>
        a.kb_id === kbId ? { ...a, instructions: instructions || undefined } : a
      )
    );
  };

  return (
    <div className="space-y-3">
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      {/* Attached knowledge bases */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((att) => {
            const kb = knowledgeBases.find((k) => k.id === att.kb_id);
            if (!kb) return null;
            const isExpanded = expandedIds.has(att.kb_id) || !!att.instructions;
            return (
              <div key={att.kb_id} className="rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3 px-3 py-2">
                  <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">{kb.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {kb.entry_count} {kb.entry_count === 1 ? 'entry' : 'entries'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(att.kb_id)}
                    disabled={disabled}
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isExpanded ? (
                  <div className="border-t px-3 py-2.5">
                    <textarea
                      value={att.instructions || ''}
                      onChange={(e) => handleInstructionsChange(att.kb_id, e.target.value)}
                      rows={4}
                      placeholder="How should the AI use this knowledge base? Any additional context..."
                      disabled={disabled}
                      className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(att.kb_id)}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-sm text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add instructions for the AI...
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Popover picker */}
      <Popover open={pickerOpen} onOpenChange={(open: boolean) => { setPickerOpen(open); if (!open) setSearch(''); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 cursor-pointer disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            Assign knowledge bases...
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <div className="border-b p-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 text-sm border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No knowledge bases match your search
              </p>
            ) : (
              filtered.map((kb) => {
                const isAssigned = assignedIds.has(kb.id);
                return (
                  <button
                    key={kb.id}
                    type="button"
                    onClick={() => handleToggle(kb.id)}
                    className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left transition-colors hover:bg-accent cursor-pointer"
                  >
                    <span className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                      isAssigned ? 'border-primary bg-primary' : 'border-border'
                    )}>
                      {isAssigned && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{kb.name}</p>
                    </div>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {kb.entry_count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {createHref && (
            <div className="border-t p-1.5">
              <Button size="sm" variant="ghost" className="w-full justify-start text-xs h-7" asChild>
                <Link to={createHref}>
                  <Plus className="mr-1.5 h-3 w-3" />
                  Create new knowledge base
                </Link>
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
