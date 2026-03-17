import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Send, Zap, Clock, CalendarClock, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTomorrowAt, getNextMondayAt } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import { useCannedResponses, type CannedResponse } from '@/hooks/useCannedResponses';
import { useLinkPreview } from '@/hooks/useLinkPreview';
import type { Message } from '@/hooks/useMessages';
import { PlanGate } from '@/components/auth/PlanGate';
import { usePlan } from '@/contexts/PlanContext';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordButton } from './VoiceRecordButton';
import { VoiceRecordingBar } from './VoiceRecordingBar';
import { toast } from 'sonner';

interface MessageInputProps {
  onSend: (body: string) => Promise<void>;
  onSendVoiceNote: (blob: Blob, duration: number) => Promise<void>;
  onSchedule: (body: string, scheduledFor: string) => Promise<void>;
  disabled?: boolean;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}

function getSchedulePresets(tz?: string): { label: string; getDate: () => Date }[] {
  return [
    { label: 'In 1 hour', getDate: () => new Date(Date.now() + 3_600_000) },
    { label: 'In 3 hours', getDate: () => new Date(Date.now() + 3 * 3_600_000) },
    { label: 'Tomorrow 9am', getDate: () => getTomorrowAt(tz, 9) },
    { label: 'Next Monday 9am', getDate: () => getNextMondayAt(tz, 9) },
  ];
}

export default function MessageInput({ onSend, onSendVoiceNote, onSchedule, disabled, initialDraft, onDraftChange, replyingTo, onCancelReply }: MessageInputProps) {
  const { companyTimezone } = useSession();
  const { hasActivePlan, planLoading, openNoPlanModal } = usePlan();
  const [text, setText] = useState(initialDraft || '');
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyQuery, setQuickReplyQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { responses } = useCannedResponses();

  // ── Voice recording ──────────────────────────────────────────────────────
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);

  const handleVoiceSend = useCallback(async (blob: Blob, dur: number) => {
    try {
      await onSendVoiceNote(blob, dur);
    } catch {
      // Error toast handled by caller
    }
    setIsRecordingLocked(false);
  }, [onSendVoiceNote]);

  const recorder = useVoiceRecorder((blob, dur) => {
    // Auto-stop at 15 min triggers send
    handleVoiceSend(blob, dur);
  });

  const handleVoiceRecordStop = useCallback(async () => {
    const { blob, duration: dur } = await recorder.stop();
    handleVoiceSend(blob, dur);
  }, [recorder, handleVoiceSend]);

  const handleVoiceLock = useCallback(() => {
    setIsRecordingLocked(true);
  }, []);

  const handleVoiceBarSend = useCallback(async () => {
    const { blob, duration: dur } = await recorder.stop();
    handleVoiceSend(blob, dur);
  }, [recorder, handleVoiceSend]);

  const handleVoiceBarDelete = useCallback(() => {
    recorder.cancel();
    setIsRecordingLocked(false);
  }, [recorder]);

  useEffect(() => {
    if (recorder.error) {
      toast.error(recorder.error);
    }
  }, [recorder.error]);

  // Note: conversation switching is handled via key={sessionId} on the parent,
  // which remounts this component with the correct initialDraft. No useEffect
  // needed — this prevents refetchConvs() from overwriting the input mid-typing.

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
    // Clear input immediately for responsive feel (don't wait for server)
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      await onSend(trimmed);
      // Don't call onDraftChange here — handleSend in InboxPage already
      // clears the draft before the await to prevent race conditions.
    } catch {
      // Restore text on failure so the user doesn't lose their message
      setText(trimmed);
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

  const presets = getSchedulePresets(companyTimezone);
  const hasText = text.trim().length > 0;

  // Link preview for URLs typed in the input
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const { preview: typedLinkPreview, loading: previewLoading } = useLinkPreview(
    previewDismissed ? null : text
  );
  // Reset dismissal when text changes substantially (new URL typed)
  const lastPreviewUrl = useRef<string | null>(null);
  useEffect(() => {
    if (typedLinkPreview?.url && typedLinkPreview.url !== lastPreviewUrl.current) {
      lastPreviewUrl.current = typedLinkPreview.url;
      setPreviewDismissed(false);
    }
  }, [typedLinkPreview?.url]);

  return (
    <div className="relative z-10 border-t bg-background">
      {/* Link preview banner */}
      {typedLinkPreview && !previewDismissed && (
        <div className="border-b px-4 py-3">
          <div className="flex items-start gap-3.5">
            {typedLinkPreview.image && (
              <img
                src={typedLinkPreview.image}
                alt=""
                className="h-[90px] w-[90px] shrink-0 rounded-lg object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <ExternalLink className="h-3 w-3" />
                {(() => { try { return new URL(typedLinkPreview.url).hostname.replace(/^www\./, ''); } catch { return ''; } })()}
              </div>
              {typedLinkPreview.title && (
                <p className="mt-1 text-sm font-semibold leading-snug line-clamp-2">{typedLinkPreview.title}</p>
              )}
              {typedLinkPreview.description && (
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground line-clamp-2">{typedLinkPreview.description}</p>
              )}
            </div>
            <button
              onClick={() => setPreviewDismissed(true)}
              className="shrink-0 rounded p-0.5 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}
      {previewLoading && !typedLinkPreview && !previewDismissed && (
        <div className="border-b px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Loading link preview...</p>
        </div>
      )}

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

      {isRecordingLocked ? (
        <VoiceRecordingBar
          state={recorder.state}
          duration={recorder.duration}
          analyserNode={recorder.analyserNode}
          onSend={handleVoiceBarSend}
          onDelete={handleVoiceBarDelete}
          onPause={recorder.pause}
          onResume={recorder.resume}
        />
      ) : (
      <div className="relative flex items-end gap-2 p-3">
      {/* Quick replies popup */}
      {showQuickReplies && filteredResponses.length > 0 && (
        <div className="absolute bottom-full left-3 right-14 mb-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            <Zap className="h-3 w-3" />
            Quick Replies
          </div>
          {(() => {
            const personalReplies = filteredResponses.filter(r => r.visibility === 'personal');
            const companyReplies = filteredResponses.filter(r => r.visibility !== 'personal');
            let globalIndex = 0;
            const renderItem = (response: CannedResponse) => {
              const idx = globalIndex++;
              return (
                <button
                  key={response.id}
                  className={cn(
                    'flex w-full flex-col rounded-sm px-3 py-2 text-left text-sm hover:bg-accent',
                    idx === selectedIndex && 'bg-accent'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertCannedResponse(response);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
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
              );
            };
            return (
              <>
                {personalReplies.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Your Replies</div>
                    {personalReplies.map(renderItem)}
                  </>
                )}
                {companyReplies.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Company Replies</div>
                    {companyReplies.map(renderItem)}
                  </>
                )}
              </>
            );
          })()}
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
      <Popover
        open={scheduleOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen && !planLoading && !hasActivePlan) {
            openNoPlanModal();
            return;
          }
          setScheduleOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            disabled={!hasText || disabled || sending}
            className="h-9 w-9 shrink-0"
            title="Schedule message"
          >
            <Clock className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className={cn('p-2', showCustomPicker ? 'w-auto' : 'w-56')}
          onCloseAutoFocus={() => setShowCustomPicker(false)}
        >
          {showCustomPicker ? (
            <div>
              <div className="flex items-center gap-2 px-2 pb-2">
                <button
                  type="button"
                  onClick={() => setShowCustomPicker(false)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  &larr; Back
                </button>
                <p className="text-xs font-medium text-muted-foreground">Pick date &amp; time</p>
              </div>
              <DateTimePicker
                minDate={new Date()}
                onChange={(date) => setCustomDate(date.toISOString())}
              />
              {customDate && (
                <div className="px-3 pb-2">
                  <Button
                    size="sm"
                    className="h-8 w-full text-xs"
                    onClick={handleCustomSchedule}
                    disabled={!customDate || new Date(customDate) <= new Date()}
                  >
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                    Schedule
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-1">
                <p className="text-xs font-medium text-muted-foreground">Schedule send</p>
                <span className="text-[10px] text-muted-foreground">{companyTimezone}</span>
              </div>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="flex w-full rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => handleSchedule(preset.getDate())}
                >
                  {preset.label}
                </button>
              ))}
              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowCustomPicker(true)}
                >
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  Custom date &amp; time
                </button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {hasText ? (
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
      ) : (
        typeof MediaRecorder !== 'undefined' && (
          <PlanGate>
            <VoiceRecordButton
              onRecordStart={recorder.start}
              onRecordStop={handleVoiceRecordStop}
              onLock={handleVoiceLock}
              onCancel={recorder.cancel}
              disabled={disabled}
            />
          </PlanGate>
        )
      )}
      </div>
      )}
    </div>
  );
}
