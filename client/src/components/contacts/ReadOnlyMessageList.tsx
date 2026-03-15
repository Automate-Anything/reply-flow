import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Check, CheckCheck, AlertCircle, FileText, Loader2 } from 'lucide-react';
import type { Message } from '@/hooks/useMessages';
import api from '@/lib/api';

// ── Media URL hook (simplified from MessageBubble) ───────────────────────────

const mediaUrlCache = new Map<string, { url: string; fetchedAt: number }>();
const CACHE_TTL_MS = 50 * 60 * 1000;

function useMediaUrl(message: Message) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasMedia = !!message.media_storage_path;
  const isMediaMessage = ['image', 'video', 'audio', 'ptt', 'voice', 'document'].includes(message.message_type);
  const shouldFetch = hasMedia || isMediaMessage;
  const messageId = message.id;

  const fetchUrl = useCallback(async () => {
    if (!shouldFetch) return;

    const cached = mediaUrlCache.get(messageId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setUrl(cached.url);
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get(`/messages/${messageId}/media`);
      if (data.url) {
        mediaUrlCache.set(messageId, { url: data.url, fetchedAt: Date.now() });
        setUrl(data.url);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [messageId, shouldFetch]);

  useEffect(() => {
    fetchUrl();
  }, [fetchUrl]);

  return { url, loading };
}

// ── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'sent':
      return <Check className="h-3 w-3" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3" />;
    case 'read':
    case 'played':
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

// ── Media renderer ───────────────────────────────────────────────────────────

function MediaBlock({ message }: { message: Message }) {
  const { url, loading } = useMediaUrl(message);
  const type = message.message_type;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs opacity-60">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading media...</span>
      </div>
    );
  }

  if (!url) return null;

  if (type === 'image') {
    return (
      <img
        src={url}
        alt={message.media_filename || 'Image'}
        className="max-h-56 w-full rounded-lg object-cover"
        loading="lazy"
      />
    );
  }

  if (type === 'document') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-xs underline"
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span className="truncate">{message.media_filename || 'Document'}</span>
      </a>
    );
  }

  if (type === 'audio' || type === 'ptt' || type === 'voice') {
    return <audio src={url} controls className="w-full" preload="metadata" />;
  }

  if (type === 'video') {
    return <video src={url} controls className="max-h-56 w-full" preload="metadata" />;
  }

  return null;
}

// ── Single message bubble ────────────────────────────────────────────────────

function MessageBubble({ message, contactName: _contactName }: { message: Message; contactName?: string }) {
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isHuman = message.sender_type === 'human';
  const isMediaType = ['image', 'video', 'audio', 'ptt', 'voice', 'document'].includes(message.message_type);
  const reply = message.metadata?.reply as { quoted_content?: string } | undefined;

  const formattedTime = new Date(message.message_ts || message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  let senderLabel = '';
  if (isAI) senderLabel = 'AI';
  else if (isHuman) senderLabel = 'You';

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[70%]">
        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isOutbound
              ? isAI
                ? 'bg-purple-100 dark:bg-purple-950'
                : 'bg-primary/90 text-primary-foreground'
              : 'bg-muted'
          )}
        >
          {/* Quoted message */}
          {reply?.quoted_content && (
            <div
              className={cn(
                'mb-1.5 rounded border-l-2 px-2 py-1 text-xs',
                isOutbound ? 'border-white/50 bg-black/10' : 'border-primary/50 bg-background/50'
              )}
            >
              <p className="line-clamp-2 opacity-70">{reply.quoted_content}</p>
            </div>
          )}

          {/* Media */}
          {isMediaType && (
            <div className="mb-1">
              <MediaBlock message={message} />
            </div>
          )}

          {/* Text body */}
          {message.message_body && (
            <p className="whitespace-pre-wrap text-sm">{message.message_body}</p>
          )}
        </div>

        {/* Timestamp + sender label */}
        <div className={cn('mt-0.5 flex items-center gap-1 text-[10px] opacity-60', isOutbound ? 'justify-end' : 'justify-start')}>
          {senderLabel && <span>{senderLabel}</span>}
          {senderLabel && <span>&middot;</span>}
          <span>{formattedTime}</span>
          {isOutbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface ReadOnlyMessageListProps {
  messages: Message[];
  loading: boolean;
  contactName?: string;
}

export default function ReadOnlyMessageList({ messages, loading, contactName }: ReadOnlyMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on mount / when messages load
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No messages</p>
    );
  }

  return (
    <div ref={containerRef} className="space-y-2 overflow-y-auto">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} contactName={contactName} />
      ))}
    </div>
  );
}
