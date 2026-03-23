import { useEffect, useRef, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowDown, Reply, ReplyAll, Forward } from 'lucide-react';
import type { EmailComposerMode } from './EmailComposer';
import MessageBubble from './MessageBubble';
import MessageContextMenu from './MessageContextMenu';
import MessageInput from './MessageInput';
import EmailMessageCard from './EmailMessageCard';
import type { Message } from '@/hooks/useMessages';

interface ComplianceResult {
  warnings: string[];
  remaining: number;
  limit: number;
  resetsAt: string;
}

interface MessageThreadProps {
  messages: Message[];
  loading: boolean;
  sessionId: string;
  channelId?: number;
  channelType?: string;
  contactName?: string;
  contactAvatarUrl?: string | null;
  contactEmail?: string;
  onSend: (body: string) => Promise<{ compliance?: ComplianceResult } | void>;
  onSendEmail?: (data: { htmlBody: string; textBody: string; subject: string; to: string; cc: string[]; bcc: string[] }) => void;
  onSendVoiceNote: (blob: Blob, duration: number) => Promise<void>;
  onSchedule: (body: string, scheduledFor: string) => Promise<void>;
  onCancelScheduled: (messageId: string) => Promise<void>;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  replyingTo?: Message | null;
  onReply?: (message: Message) => void;
  onCancelReply?: () => void;
  onMessageUpdate: (message: Message) => void;
  onForward: (message: Message) => void;
  isDebugMode?: boolean;
}

const SCROLL_STORAGE_KEY = 'reply-flow-scroll-positions';
const NEAR_BOTTOM_THRESHOLD = 150;

function getScrollPositions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveScrollPosition(sessionId: string, scrollTop: number) {
  const positions = getScrollPositions();
  positions[sessionId] = scrollTop;
  sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
}

export default function MessageThread({
  messages,
  loading,
  sessionId,
  channelId,
  channelType,
  contactName,
  contactAvatarUrl,
  contactEmail,
  onSend,
  onSendEmail,
  onSendVoiceNote,
  onSchedule,
  onCancelScheduled,
  initialDraft,
  onDraftChange,
  replyingTo,
  onReply,
  onCancelReply,
  onMessageUpdate,
  onForward,
  isDebugMode,
}: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const restoredForSessionRef = useRef<string | null>(null);
  const wasLoadingRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [emailComposerMode, setEmailComposerMode] = useState<EmailComposerMode | null>(null);
  const isEmail = channelType === 'email';

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, []);

  // Track scroll position for persistence + show/hide scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setShowScrollDown(!isNearBottom());
    // Only save scroll position if we've finished restoring for this session
    if (restoredForSessionRef.current === sessionId) {
      saveScrollPosition(sessionId, el.scrollTop);
    }
  }, [sessionId, isNearBottom]);

  // Handle scroll on message changes: restore position, stick to bottom, or leave alone
  useEffect(() => {
    // Track loading state so we know when fresh messages arrive
    if (loading) {
      wasLoadingRef.current = true;
      return;
    }
    if (messages.length === 0) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    // First load for this session — only after loading→loaded transition
    if (restoredForSessionRef.current !== sessionId && wasLoadingRef.current) {
      wasLoadingRef.current = false;
      restoredForSessionRef.current = sessionId;
      prevMessageCountRef.current = messages.length;
      setShowScrollDown(false);
      setEmailComposerMode(null);

      const positions = getScrollPositions();
      const savedScroll = positions[sessionId];
      // Defer scroll restore to next frame so the browser has finished layout
      requestAnimationFrame(() => {
        if (savedScroll !== undefined && savedScroll > 0) {
          el.scrollTop = savedScroll;
        } else {
          bottomRef.current?.scrollIntoView();
        }
      });
      return;
    }

    // New messages arrived — scroll to bottom only if user was already near bottom
    if (messages.length > prevMessageCountRef.current) {
      if (isNearBottom()) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }

    prevMessageCountRef.current = messages.length;
  }, [messages, loading, sessionId, isNearBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-component="MessageThread">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-4 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-400/50 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
                >
                  <Skeleton className="h-12 w-48 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No messages yet. Send a message to start the conversation.
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((msg, idx) =>
                channelType === 'email' ? (
                  <EmailMessageCard
                    key={msg.id}
                    message={msg}
                    contactName={contactName}
                    isLast={idx === messages.length - 1}
                  />
                ) : (
                  <MessageContextMenu
                    key={msg.id}
                    message={msg}
                    sessionId={sessionId}
                    onReply={onReply || (() => {})}
                    onMessageUpdate={onMessageUpdate}
                    onForward={onForward}
                  >
                    <MessageBubble
                      message={msg}
                      messages={messages}
                      contactName={contactName}
                      contactAvatarUrl={contactAvatarUrl}
                      onCancelScheduled={msg.status === 'scheduled' ? onCancelScheduled : undefined}
                      onReply={onReply}
                      onMessageUpdate={onMessageUpdate}
                      isDebugMode={isDebugMode}
                    />
                  </MessageContextMenu>
                )
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border bg-background shadow-lg transition-colors hover:bg-accent"
            title="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Email: show Reply/Reply All/Forward buttons, then composer when clicked */}
      {isEmail && !emailComposerMode ? (
        <div className="border-t bg-background px-4 py-3 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEmailComposerMode('reply')}>
            <Reply className="mr-1.5 h-4 w-4" />
            Reply
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEmailComposerMode('reply-all')}>
            <ReplyAll className="mr-1.5 h-4 w-4" />
            Reply all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEmailComposerMode('forward')}>
            <Forward className="mr-1.5 h-4 w-4" />
            Forward
          </Button>
        </div>
      ) : isEmail && emailComposerMode ? (
        (() => {
          const lastMsg = messages[messages.length - 1];
          const meta = (lastMsg?.metadata || {}) as Record<string, unknown>;
          const lastSubject = (meta.subject as string) || '';
          const lastTo = (meta.to as string) || '';
          const lastCc = (meta.cc as string) || '';
          const lastHtml = (meta.html_body as string) || lastMsg?.message_body || '';

          // For Reply All: CC = all recipients except yourself
          const replyAllCc = emailComposerMode === 'reply-all'
            ? [lastTo, lastCc].filter(Boolean).join(', ')
            : '';

          return (
            <MessageInput
              key={`${sessionId}-${emailComposerMode}`}
              sessionId={sessionId}
              channelId={channelId}
              channelType={channelType}
              onSend={onSend}
              onSendVoiceNote={onSendVoiceNote}
              onSchedule={onSchedule}
              initialDraft={initialDraft}
              onDraftChange={onDraftChange}
              replyingTo={replyingTo}
              onCancelReply={onCancelReply}
              contactEmail={contactEmail}
              emailSubject={lastSubject}
              emailComposerMode={emailComposerMode}
              emailCc={replyAllCc}
              emailQuotedHtml={lastHtml}
              onCancelEmailComposer={() => setEmailComposerMode(null)}
              onSendEmail={onSendEmail}
            />
          );
        })()
      ) : (
        <MessageInput
          key={sessionId}
          sessionId={sessionId}
          channelId={channelId}
          channelType={channelType}
          onSend={onSend}
          onSendVoiceNote={onSendVoiceNote}
          onSchedule={onSchedule}
          initialDraft={initialDraft}
          onDraftChange={onDraftChange}
          replyingTo={replyingTo}
          onCancelReply={onCancelReply}
          contactEmail={contactEmail}
          emailSubject={
            channelType === 'email' && messages.length > 0
              ? ((messages[messages.length - 1].metadata as Record<string, unknown> | null)?.subject as string) || ''
              : undefined
          }
          onSendEmail={onSendEmail}
        />
      )}
    </div>
  );
}
