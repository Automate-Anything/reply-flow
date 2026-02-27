import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCannedResponses, type CannedResponse } from '@/hooks/useCannedResponses';

interface MessageInputProps {
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyQuery, setQuickReplyQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { responses } = useCannedResponses();

  const filteredResponses = useMemo(() => {
    if (!quickReplyQuery) return responses;
    const q = quickReplyQuery.toLowerCase();
    return responses.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.shortcut && r.shortcut.toLowerCase().includes(q)) ||
        r.content.toLowerCase().includes(q)
    );
  }, [responses, quickReplyQuery]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  };

  const insertCannedResponse = (response: CannedResponse) => {
    // Replace the /query with the canned response content
    const slashIndex = text.lastIndexOf('/');
    const before = slashIndex > 0 ? text.slice(0, slashIndex) : '';
    setText(before + response.content);
    setShowQuickReplies(false);
    setQuickReplyQuery('');
    textareaRef.current?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);

    // Check for "/" trigger
    const slashIndex = value.lastIndexOf('/');
    if (slashIndex !== -1 && (slashIndex === 0 || value[slashIndex - 1] === ' ' || value[slashIndex - 1] === '\n')) {
      const query = value.slice(slashIndex + 1);
      // Only show if no spaces in the query (single-word trigger) or allow searching
      if (!query.includes('\n')) {
        setShowQuickReplies(true);
        setQuickReplyQuery(query);
        setSelectedIndex(0);
        return;
      }
    }
    setShowQuickReplies(false);
    setQuickReplyQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showQuickReplies && filteredResponses.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredResponses.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertCannedResponse(filteredResponses[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowQuickReplies(false);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        insertCannedResponse(filteredResponses[selectedIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [text]);

  return (
    <div className="relative flex items-end gap-2 border-t bg-background p-3">
      {/* Quick replies popup */}
      {showQuickReplies && filteredResponses.length > 0 && (
        <div className="absolute bottom-full left-3 right-14 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            <Zap className="h-3 w-3" />
            Quick Replies
          </div>
          {filteredResponses.map((response, i) => (
            <button
              key={response.id}
              className={cn(
                'flex w-full flex-col rounded-sm px-3 py-2 text-left text-sm hover:bg-accent',
                i === selectedIndex && 'bg-accent'
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                insertCannedResponse(response);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{response.title}</span>
                {response.shortcut && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    /{response.shortcut}
                  </span>
                )}
              </div>
              <span className="mt-0.5 truncate text-xs text-muted-foreground">
                {response.content}
              </span>
            </button>
          ))}
        </div>
      )}

      {showQuickReplies && filteredResponses.length === 0 && quickReplyQuery && (
        <div className="absolute bottom-full left-3 right-14 mb-1 rounded-md border bg-popover px-3 py-2 shadow-md">
          <p className="text-xs text-muted-foreground">No quick replies matching "{quickReplyQuery}"</p>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay hiding to allow clicking on a response
          setTimeout(() => setShowQuickReplies(false), 200);
        }}
        placeholder="Type a message... (/ for quick replies)"
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={!text.trim() || disabled || sending}
        className="h-9 w-9 shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
