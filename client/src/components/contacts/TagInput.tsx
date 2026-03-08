import { useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ContactTag } from '@/hooks/useContactTags';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  availableTags: ContactTag[];
  onCreateTag?: (name: string) => Promise<void>;
  disabled?: boolean;
}

export default function TagInput({ value, onChange, availableTags, onCreateTag, disabled }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tagColorMap = new Map(availableTags.map((t) => [t.name, t.color]));

  const filteredTags = availableTags.filter(
    (tag) =>
      !value.includes(tag.name) &&
      tag.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  const exactMatch = availableTags.some(
    (t) => t.name.toLowerCase() === inputValue.trim().toLowerCase()
  );
  const alreadySelected = value.some(
    (v) => v.toLowerCase() === inputValue.trim().toLowerCase()
  );
  const showCreate = inputValue.trim() && !exactMatch && !alreadySelected && onCreateTag;

  const addTag = (tagName: string) => {
    if (!value.includes(tagName)) {
      onChange([...value, tagName]);
    }
    setInputValue('');
  };

  const removeTag = (tagName: string) => {
    onChange(value.filter((t) => t !== tagName));
  };

  const handleCreateAndAdd = async () => {
    const name = inputValue.trim();
    if (!name || !onCreateTag) return;
    await onCreateTag(name);
    addTag(name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreate) {
        handleCreateAndAdd();
      } else if (filteredTags.length > 0) {
        addTag(filteredTags[0].name);
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) setInputValue('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
          onClick={() => {
            if (!disabled) {
              inputRef.current?.focus();
              setOpen(true);
            }
          }}
        >
          {value.map((tagName) => {
            const color = tagColorMap.get(tagName);
            return (
              <Badge
                key={tagName}
                variant={color ? 'default' : 'secondary'}
                className="gap-1 pr-1 text-xs"
                style={color ? { backgroundColor: color, color: 'white' } : undefined}
              >
                {tagName}
                {!disabled && (
                  <button
                    type="button"
                    className="ml-0.5 rounded-full p-0.5 hover:bg-black/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tagName);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            );
          })}
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? 'Add tags...' : ''}
            disabled={disabled}
            className="min-w-[60px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {filteredTags.length === 0 && !showCreate ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {inputValue ? 'No matching tags' : 'No tags available'}
          </p>
        ) : (
          <div className="max-h-48 overflow-auto">
            {filteredTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  addTag(tag.name);
                  setOpen(false);
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            ))}
            {showCreate && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-primary hover:bg-accent"
                onClick={handleCreateAndAdd}
              >
                <Plus className="h-3.5 w-3.5" />
                Create "{inputValue.trim()}"
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
