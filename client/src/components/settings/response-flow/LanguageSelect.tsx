import { useState, useRef, useEffect } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const COMMON_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Dutch',
  'Russian',
  'Chinese',
  'Japanese',
  'Korean',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Turkish',
  'Polish',
  'Swedish',
  'Thai',
  'Vietnamese',
  'Indonesian',
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function LanguageSelect({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? COMMON_LANGUAGES.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : COMMON_LANGUAGES;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (lang: string) => {
    onChange(lang);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setOpen(!open);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm',
          'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value || 'Select a language...'}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-1.5">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search languages..."
              className="w-full rounded-sm border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  handleSelect(filtered[0]);
                }
                if (e.key === 'Escape') {
                  setOpen(false);
                  setSearch('');
                }
              }}
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No match. Type a custom language and press Enter.
              </p>
            ) : (
              filtered.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleSelect(lang)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer',
                    'hover:bg-accent hover:text-accent-foreground',
                    value === lang && 'bg-accent/50',
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5', value === lang ? 'opacity-100' : 'opacity-0')} />
                  {lang}
                </button>
              ))
            )}
            {search && !filtered.some((l) => l.toLowerCase() === search.toLowerCase()) && (
              <button
                type="button"
                onClick={() => handleSelect(search)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground border-t mt-1 pt-1.5"
              >
                <Check className="h-3.5 w-3.5 opacity-0" />
                Use "{search}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
