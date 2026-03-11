import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Send, Zap, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCannedResponses, type CannedResponse } from '@/hooks/useCannedResponses';
import type { Message } from '@/hooks/useMessages';
import { PlanGate } from '@/components/auth/PlanGate';
import { usePlan } from '@/contexts/PlanContext';

interface MessageInputProps {
  onSend: (body: string) => Promise<void>;
  onSchedule: (body: string, scheduledFor: string) => Promise<void>;
  disabled?: boolean;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}

function getSchedulePresets(): { label: string; getDate: () => Date }[] {
  return [
    {
      label: 'In 1 hour',
      getDate: () => new Date(Date.now() + 3_600_000),
    },
    {
      label: 'In 3 hours',
      getDate: () => new Date(Date.now() + 3 * 3_600_000),
    },
    {
      label: 'Tomorrow 9am',
      getDate: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: 'Next Monday 9am',
      getDate: () => {
        const d = new Date();
        const daysUntilMonday = ((8 - d.getDay()) % 7) || 7;
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];
}

export default function MessageInput({ onSend, onSchedule, disabled, initialDraft, onDraftChange, replyingTo, onCancelReply }: MessageInputProps) {
  const { hasActivePlan, planLoading, openNoPlanModal } = usePlan();
  const [text, setText] = useState(initialDraft || '');
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyQuery, setQuickReplyQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { responses } = useCannedResponses();

  // Sync text when switching conversations
  useEffect(() => {
    setText(initialDraft || '');
  }, [initialDraft]);

  const filteredResponses = useMemo(() => {
    if (!quickReplyQuery) return responses;
    const q = quickReplyQuery.toLowerCase();
    return responses
      .filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.shortcut && r.shortcut.toLowerCase().includes(q)) ||
          r.content.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const aShortcut = a.shortcut?.toLowerCase() || '';
        const bShortcut = b.shortcut?.toLowerCase() || '';
        const aExact = aShortcut === q ? 1 : 0;
        const bExact = bShortcut === q ? 1 : 0;
        return bExact - aExact || a.title.localeCompare(b.title);
      });
  }, [responses, quickReplyQuery]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
      onDraftChange?.('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async (scheduledFor: Date) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSchedule(trimmed, scheduledFor.toISOString());
      setText('');
      onDraftChange?.('');
      setScheduleOpen(false);
      setCustomDate('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  };

  const handleCustomSchedule = () => {
    if (!customDate) return;
    const date = new Date(customDate);
    if (date <= new Date()) return;
    handleSchedule(date);
  };

  const insertCannedResponse = (response: CannedResponse) => {
    const match = text.match(/(^|[\s\n])\/([^\s\n]*)$/);
    const replacement = `${match?.[1] || ''}${response.content}`;
    const newText = match
      ? `${text.slice(0, text.length - match[0].length)}${replacement}`
      : response.content;
    setText(newText);
    onDraftChange?.(newText);
    setShowQuickReplies(false);
    setQuickReplyQuery('');
    textareaRef.current?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    onDraftChange?.(value);

    const slashIndex = value.lastIndexOf('/');
    if (slashIndex !== -1 && (slashIndex === 0 || value[slashIndex - 1] === ' ' || value[slashIndex - 1] === '\n')) {
      const query = value.slice(slashIndex + 1);
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
      if (!planLoading && !hasActivePlan) {
        openNoPlanModal();
        return;
      }
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

  const presets = getSchedulePresets();
  const hasText = text.trim().length > 0;

  // Minimum datetime-local value (now + 1 min)
  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <div className="border-t bg-background">
      {/* Reply banner */}
      {replyingTo && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <div className="h-8 w-0.5 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-muted-foreground">
              Replying to {replyingTo.sender_type === 'contact' ? 'contact' : 'yourself'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {replyingTo.message_body || '[Media message]'}
            </p>
          </div>
          <button
            onClick={onCancelReply}
            className="shrink-0 rounded p-0.5 hover:bg-muted"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2 p-3">
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
          <p className="text-xs text-muted-foreground">No quick replies matching &quot;{quickReplyQuery}&quot;</p>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setTimeout(() => setShowQuickReplies(false), 200);
        }}
        placeholder="Type a message... (/ for quick replies)"
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      {/* Schedule send button */}
      <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <PopoverTrigger asChild>
          <PlanGate>
            <Button
              size="icon"
              variant="ghost"
              disabled={!hasText || disabled || sending}
              className="h-9 w-9 shrink-0"
              title="Schedule message"
            >
              <Clock className="h-4 w-4" />
            </Button>
          </PlanGate>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" sideOffset={8} className="w-56 p-2">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Schedule send</p>
          {presets.map((preset) => (
            <button
              key={preset.label}
              className="flex w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
              onClick={() => handleSchedule(preset.getDate())}
            >
              {preset.label}
            </button>
          ))}
          <div className="mt-1 border-t pt-1">
            <p className="px-2 py-1 text-xs text-muted-foreground">Custom time</p>
            <input
              type="datetime-local"
              min={minDateTime}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {customDate && (
              <Button
                size="sm"
                className="mt-1 w-full h-7 text-xs"
                onClick={handleCustomSchedule}
                disabled={!customDate || new Date(customDate) <= new Date()}
              >
                Schedule
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <PlanGate>
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!hasText || disabled || sending}
          className="h-9 w-9 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </PlanGate>
      </div>
    </div>
  );
}
