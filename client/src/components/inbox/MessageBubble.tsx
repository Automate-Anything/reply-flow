import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Clock, Download, FileText, Image as ImageIcon, Loader2, Mic, Pause, Pin, Play, Reply, Star, X } from 'lucide-react';
import type { Message } from '@/hooks/useMessages';
import AIDebugPanel from './AIDebugPanel';
import type { AIDebugData } from './AIDebugPanel';
import api from '@/lib/api';

interface ReplyMetadata {
  quoted_message_id: string | null;
  quoted_content: string | null;
  quoted_sender: string | null;
  quoted_type: string | null;
}

interface MessageBubbleProps {
  message: Message;
  onCancelScheduled?: (messageId: string) => Promise<void>;
  onReply?: (message: Message) => void;
  isDebugMode?: boolean;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatScheduledTime(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffMs <= 0) return 'Sending...';
  if (diffH < 1) return `in ${Math.ceil(diffMs / 60_000)}m`;
  if (diffH < 24) return `in ${diffH}h`;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function groupReactions(reactions: Array<{ emoji: string; user_id: string }>): Array<{ emoji: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of reactions) {
    map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
  }
  return Array.from(map, ([emoji, count]) => ({ emoji, count }));
}

// ── Media URL cache (avoids re-fetching signed URLs for the same message) ────
const mediaUrlCache = new Map<string, { url: string; fetchedAt: number }>();
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (signed URLs last 60 min)

function useMediaUrl(message: Message) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasMedia = !!message.media_storage_path;
  const messageId = message.id;

  const fetchUrl = useCallback(async () => {
    if (!hasMedia) return;

    // Check cache
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
      // Silently fail — media just won't show
    } finally {
      setLoading(false);
    }
  }, [messageId, hasMedia]);

  useEffect(() => {
    fetchUrl();
  }, [fetchUrl]);

  return { url, loading };
}

// ── Voice note player (WhatsApp-style) ───────────────────────────────────────

function VoiceNotePlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => setDuration(audio.duration || 0);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { audio.play(); }
    setPlaying(!playing);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={toggle}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
          isOutbound
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-primary/10 hover:bg-primary/20 text-primary'
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className={cn(
            'relative h-1.5 w-full cursor-pointer rounded-full',
            isOutbound ? 'bg-white/20' : 'bg-muted-foreground/20'
          )}
          onClick={seek}
        >
          <div
            className={cn(
              'absolute left-0 top-0 h-full rounded-full transition-[width] duration-100',
              isOutbound ? 'bg-white/70' : 'bg-primary/60'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Mic className={cn('h-3 w-3', isOutbound ? 'text-white/60' : 'text-muted-foreground')} />
          <span className={cn('text-[10px]', isOutbound ? 'text-white/60' : 'text-muted-foreground')}>
            {playing ? fmt(currentTime) : fmt(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Media renderers ──────────────────────────────────────────────────────────

function MediaContent({ message, mediaUrl, mediaLoading, isOutbound }: { message: Message; mediaUrl: string | null; mediaLoading: boolean; isOutbound: boolean }) {
  const [imageExpanded, setImageExpanded] = useState(false);
  const mime = message.media_mime_type || '';
  const type = message.message_type;

  if (mediaLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs opacity-60">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading media...</span>
      </div>
    );
  }

  if (!mediaUrl) {
    // No media URL yet — show placeholder based on type
    if (type === 'image') return <div className="flex items-center gap-1.5 py-1 text-xs opacity-60"><ImageIcon className="h-4 w-4" /><span>Image</span></div>;
    if (type === 'video') return <div className="flex items-center gap-1.5 py-1 text-xs opacity-60"><Play className="h-4 w-4" /><span>Video</span></div>;
    if (type === 'audio' || type === 'ptt') return <div className="flex items-center gap-1.5 py-1 text-xs opacity-60"><Mic className="h-4 w-4" /><span>Voice message</span></div>;
    if (type === 'document') return <div className="flex items-center gap-1.5 py-1 text-xs opacity-60"><FileText className="h-4 w-4" /><span>{message.media_filename || 'Document'}</span></div>;
    return null;
  }

  if (type === 'image' || mime.startsWith('image/')) {
    return (
      <>
        <img
          src={mediaUrl}
          alt={message.media_filename || 'Image'}
          className="max-h-64 max-w-full cursor-pointer rounded-lg object-contain"
          onClick={() => setImageExpanded(true)}
          loading="lazy"
        />
        {/* Lightbox */}
        {imageExpanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
            onClick={() => setImageExpanded(false)}
          >
            <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setImageExpanded(false)}>
              <X className="h-5 w-5" />
            </button>
            <img
              src={mediaUrl}
              alt={message.media_filename || 'Image'}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            />
          </div>
        )}
      </>
    );
  }

  if (type === 'video' || mime.startsWith('video/')) {
    return (
      <video
        src={mediaUrl}
        controls
        className="max-h-64 max-w-full rounded-lg"
        preload="metadata"
      />
    );
  }

  if (type === 'audio' || type === 'ptt' || mime.startsWith('audio/')) {
    return <VoiceNotePlayer src={mediaUrl} isOutbound={isOutbound} />;
  }

  if (type === 'document') {
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg border border-current/10 px-3 py-2 text-xs transition-colors hover:bg-current/5"
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{message.media_filename || 'Document'}</span>
        <Download className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
      </a>
    );
  }

  return null;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MessageBubble({ message, onCancelScheduled, onReply, isDebugMode }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isHuman = message.sender_type === 'human';
  const isScheduled = message.status === 'scheduled' && message.scheduled_for;
  const reply = (message.metadata?.reply as ReplyMetadata) || null;
  const reactions = groupReactions(message.reactions || []);
  const debugData = isDebugMode && isAI ? (message.metadata?.debug as AIDebugData | undefined) : undefined;

  const hasMedia = !!message.media_storage_path;
  const { url: mediaUrl, loading: mediaLoading } = useMediaUrl(message);
  const isMediaType = ['image', 'video', 'audio', 'ptt', 'document'].includes(message.message_type);
  const caption = message.message_body;
  // Don't show placeholder text as caption (e.g. "[Image]", "[Audio message]")
  const isPlaceholder = caption && /^\[.+\]$/.test(caption.trim());
  const showCaption = caption && !isPlaceholder;

  return (
    <div
      data-component="MessageBubble"
      className={cn(
        'group/msg flex w-full items-center gap-1',
        isOutbound ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Reply button — outbound messages: appears to the left */}
      {isOutbound && onReply && !isScheduled && (
        <button
          onClick={() => onReply(message)}
          className="shrink-0 rounded-full p-1 opacity-0 transition-opacity hover:bg-muted group-hover/msg:opacity-100"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      <div className={cn('max-w-[70%]', isScheduled && 'group')}>
        {isScheduled && (
          <div className="mb-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Scheduled {formatScheduledTime(message.scheduled_for!)}</span>
            {onCancelScheduled && (
              <button
                onClick={() => onCancelScheduled(message.id)}
                className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Quoted message preview */}
        {reply && (
          <div
            className={cn(
              'mb-1 rounded-lg border-l-2 border-primary/50 bg-muted/50 px-3 py-1.5 text-xs',
              isOutbound && 'ml-auto'
            )}
          >
            <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
              {reply.quoted_sender === 'contact' ? 'Contact' : 'You'}
            </p>
            <p className="line-clamp-2 text-muted-foreground">
              {reply.quoted_content || '[Media message]'}
            </p>
          </div>
        )}

        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isScheduled
              ? 'border border-dashed border-primary/30 bg-primary/5 text-foreground'
              : isOutbound
                ? isAI
                  ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100'
                  : 'bg-primary/90 text-primary-foreground'
                : 'bg-muted text-foreground'
          )}
        >
          {isAI && (
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider opacity-70">
              AI
            </span>
          )}
          {isHuman && (
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider opacity-70">
              You
            </span>
          )}

          {/* Media content */}
          {isMediaType && hasMedia && (
            <div className="mb-1">
              <MediaContent message={message} mediaUrl={mediaUrl} mediaLoading={mediaLoading} isOutbound={isOutbound} />
            </div>
          )}

          {/* Text body / caption */}
          {showCaption && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {caption}
            </p>
          )}

          {/* Fallback: no media stored yet, show the placeholder text */}
          {isMediaType && !hasMedia && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.message_body}
            </p>
          )}

          {/* Regular text message (only when showCaption hasn't already rendered the body) */}
          {!isMediaType && !showCaption && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.message_body}
            </p>
          )}
          {!isScheduled && (
            <div
              className={cn(
                'mt-1 flex items-center gap-1 text-[10px] opacity-60',
                isOutbound ? 'justify-end' : 'justify-start'
              )}
            >
              {message.is_pinned && <Pin className="h-2.5 w-2.5" />}
              {message.is_starred && <Star className="h-2.5 w-2.5 fill-current" />}
              <span>{formatTimestamp(message.message_ts || message.created_at)}</span>
            </div>
          )}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className={cn('mt-1 flex gap-0.5', isOutbound ? 'justify-end' : 'justify-start')}>
            {reactions.map(({ emoji, count }) => (
              <span
                key={emoji}
                className="rounded-full border bg-background px-1.5 py-0.5 text-xs shadow-sm"
              >
                {emoji}{count > 1 ? ` ${count}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* AI Debug Panel */}
        {debugData && <AIDebugPanel debugData={debugData} />}
      </div>

      {/* Reply button — inbound messages: appears to the right */}
      {!isOutbound && onReply && !isScheduled && (
        <button
          onClick={() => onReply(message)}
          className="shrink-0 rounded-full p-1 opacity-0 transition-opacity hover:bg-muted group-hover/msg:opacity-100"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
