import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { formatTime as formatTimestamp, formatScheduledTime } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import { Clock, Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Mic, Pause, Pin, Play, Reply, Star, X } from 'lucide-react';
import type { Message } from '@/hooks/useMessages';
import { useLinkPreview } from '@/hooks/useLinkPreview';
import type { LinkPreview } from '@/hooks/useLinkPreview';
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
  messages?: Message[];
  contactName?: string;
  onCancelScheduled?: (messageId: string) => Promise<void>;
  onReply?: (message: Message) => void;
  isDebugMode?: boolean;
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
  const isMediaMessage = ['image', 'video', 'audio', 'ptt', 'voice', 'document'].includes(message.message_type);
  const shouldFetch = hasMedia || isMediaMessage;
  const messageId = message.id;

  const fetchUrl = useCallback(async () => {
    if (!shouldFetch) return;

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
  }, [messageId, shouldFetch]);

  useEffect(() => {
    fetchUrl();
  }, [fetchUrl]);

  return { url, loading };
}

// ── Voice note player ────────────────────────────────────────────────────────

function generateWaveformBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    hash = ((hash << 5) - hash + i * 7) | 0;
    const normalized = (Math.abs(hash) % 100) / 100;
    const position = i / count;
    const envelope = Math.sin(position * Math.PI) * 0.4 + 0.6;
    bars.push(Math.max(0.15, normalized * envelope));
  }
  return bars;
}

function VoiceNotePlayer({ src, isOutbound, timeSlot }: { src: string; isOutbound: boolean; timeSlot?: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const bars = useRef<number[]>(generateWaveformBars(src, 32));

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
    <div className="flex items-center gap-2 py-0.5" style={{ minWidth: 180 }}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        onClick={toggle}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
          isOutbound
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-primary/10 hover:bg-primary/20 text-primary'
        )}
      >
        {playing
          ? <Pause className="h-3.5 w-3.5" />
          : <Play className="h-3.5 w-3.5 ml-0.5" />
        }
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Waveform bars — mirrored up/down from center */}
        <div
          className="flex h-6 cursor-pointer items-center gap-[2px]"
          onClick={seek}
        >
          {bars.current.map((height, i) => {
            const isPlayed = (i / bars.current.length) * 100 < progress;
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-full transition-colors duration-75',
                  isPlayed
                    ? isOutbound ? 'bg-white/80' : 'bg-primary/70'
                    : isOutbound ? 'bg-white/25' : 'bg-muted-foreground/25'
                )}
                style={{ height: `${Math.max(15, Math.round(height * 100))}%`, minHeight: 3 }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <span className={cn('text-[10px] tabular-nums', isOutbound ? 'text-white/60' : 'text-muted-foreground')}>
            {playing ? fmt(currentTime) : fmt(duration)}
          </span>
          {timeSlot}
        </div>
      </div>
    </div>
  );
}

// ── Media renderers ──────────────────────────────────────────────────────────

function MediaContent({ message, mediaUrl, mediaLoading, isOutbound, voiceTimeSlot }: { message: Message; mediaUrl: string | null; mediaLoading: boolean; isOutbound: boolean; voiceTimeSlot?: React.ReactNode }) {
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
    if (type === 'audio' || type === 'ptt' || type === 'voice') return <div className="flex items-center gap-1.5 py-1 text-xs opacity-60"><Mic className="h-4 w-4" /><span>Voice message</span></div>;
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

  if (type === 'audio' || type === 'ptt' || type === 'voice' || mime.startsWith('audio/')) {
    return <VoiceNotePlayer src={mediaUrl} isOutbound={isOutbound} timeSlot={voiceTimeSlot} />;
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

// Invisible spacer that reserves room for the inline timestamp at end of text
function TimeSpacer() {
  return <span className="inline-block w-[70px]" />;
}

// Inline timestamp component (floated right when inside text, standalone for voice notes)
function InlineTime({ message, isAI, isHuman, tz, standalone }: {
  message: Message;
  isAI: boolean;
  isHuman: boolean;
  tz: string;
  standalone?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] leading-none opacity-60',
        standalone
          ? 'mt-1 justify-end w-full'
          : 'float-right ml-2 mt-1 -mb-1 relative top-[2px]'
      )}
    >
      {isAI && <span className="font-medium uppercase tracking-wider">AI</span>}
      {isHuman && <span className="font-medium uppercase tracking-wider">You</span>}
      {(isAI || isHuman) && <span>·</span>}
      {message.is_pinned && <Pin className="h-2.5 w-2.5" />}
      {message.is_starred && <Star className="h-2.5 w-2.5 fill-current" />}
      <span>{formatTimestamp(message.message_ts || message.created_at, tz)}</span>
    </span>
  );
}

// ── Link preview card ────────────────────────────────────────────────────────

function LinkPreviewCard({ preview, isOutbound }: { preview: LinkPreview; isOutbound: boolean }) {
  const domain = preview.site_name || (() => {
    try { return new URL(preview.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        '-mx-2 mb-1.5 block overflow-hidden rounded-lg transition-opacity hover:opacity-90',
        isOutbound ? 'bg-black/10' : 'bg-background/60 border border-border/50'
      )}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          className="h-32 w-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="px-3 py-2">
        {domain && (
          <p className={cn(
            'mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider',
            isOutbound ? 'text-white/50' : 'text-muted-foreground'
          )}>
            <ExternalLink className="h-2.5 w-2.5" />
            {domain}
          </p>
        )}
        {preview.title && (
          <p className={cn(
            'text-xs font-medium leading-snug line-clamp-2',
            isOutbound ? 'text-white' : 'text-foreground'
          )}>
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p className={cn(
            'mt-0.5 text-[11px] leading-snug line-clamp-2',
            isOutbound ? 'text-white/60' : 'text-muted-foreground'
          )}>
            {preview.description}
          </p>
        )}
      </div>
    </a>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MessageBubble({ message, messages = [], contactName, onCancelScheduled, onReply, isDebugMode }: MessageBubbleProps) {
  const { companyTimezone: tz } = useSession();
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isHuman = message.sender_type === 'human';
  const isScheduled = message.status === 'scheduled' && message.scheduled_for;
  const reply = (message.metadata?.reply as ReplyMetadata) || null;
  const reactions = groupReactions(message.reactions || []);
  const debugData = isDebugMode && isAI ? (message.metadata?.debug as AIDebugData | undefined) : undefined;

  const hasMedia = !!message.media_storage_path;
  const { url: mediaUrl, loading: mediaLoading } = useMediaUrl(message);
  const isMediaType = ['image', 'video', 'audio', 'ptt', 'voice', 'document'].includes(message.message_type);
  const isVoiceType = ['audio', 'ptt', 'voice'].includes(message.message_type);
  const caption = message.message_body;
  // Don't show placeholder text as caption (e.g. "[Image]", "[Audio message]")
  const isPlaceholder = caption && /^\[.+\]$/.test(caption.trim());
  const showCaption = caption && !isPlaceholder;

  // Link preview: use Whapi metadata if available, otherwise fetch OG tags
  const rawStoredPreview = message.metadata?.link_preview as Record<string, string> | undefined;
  const storedPreview: LinkPreview | undefined = rawStoredPreview
    ? {
        title: rawStoredPreview.title || null,
        description: rawStoredPreview.description || null,
        image: rawStoredPreview.image || rawStoredPreview.thumbnail || null,
        site_name: rawStoredPreview.site_name || null,
        url: rawStoredPreview.url || rawStoredPreview.canonical_url || '',
      }
    : undefined;
  const hasStoredPreview = storedPreview && (storedPreview.title || storedPreview.description || storedPreview.image);
  const { preview: fetchedPreview } = useLinkPreview(
    // Only fetch if no stored preview and the message has a URL
    !hasStoredPreview && !isMediaType && caption ? caption : null
  );
  const linkPreview = hasStoredPreview ? storedPreview : fetchedPreview;

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
            <span>Scheduled {formatScheduledTime(message.scheduled_for!, tz)}</span>
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
          {/* Quoted message preview (inside bubble) */}
          {reply && (
            <div
              className={cn(
                '-mx-2 mb-1.5 rounded-lg border-l-2 px-3 py-1.5 text-xs',
                isOutbound
                  ? 'border-white/50 bg-black/10'
                  : 'border-primary/50 bg-background/50'
              )}
            >
              <p className={cn(
                'mb-0.5 text-[10px] font-medium',
                isOutbound ? 'text-white/70' : 'text-primary'
              )}>
                {(() => {
                  if (reply.quoted_sender === 'human') return 'You';
                  if (reply.quoted_sender === 'ai') return 'AI';
                  if (reply.quoted_sender === 'contact') return contactName || 'Contact';
                  const quoted = reply.quoted_message_id
                    ? messages.find((m) => m.id === reply.quoted_message_id)
                    : undefined;
                  if (quoted) {
                    if (quoted.sender_type === 'ai') return 'AI';
                    return quoted.direction === 'outbound' ? 'You' : (contactName || 'Contact');
                  }
                  return isOutbound ? (contactName || 'Contact') : 'You';
                })()}
              </p>
              <p className={cn(
                'line-clamp-2',
                isOutbound ? 'text-white/60' : 'text-muted-foreground'
              )}>
                {reply.quoted_content || '[Media message]'}
              </p>
            </div>
          )}

          {/* Link preview card */}
          {linkPreview && <LinkPreviewCard preview={linkPreview} isOutbound={isOutbound} />}

          {/* Media content */}
          {isMediaType && (hasMedia || isVoiceType) && (
            <div className="mb-1">
              <MediaContent
                message={message}
                mediaUrl={mediaUrl}
                mediaLoading={mediaLoading}
                isOutbound={isOutbound}
                voiceTimeSlot={
                  isVoiceType && !isScheduled
                    ? <InlineTime message={message} isAI={isAI} isHuman={isHuman} tz={tz} />
                    : undefined
                }
              />
            </div>
          )}

          {/* Text body / caption — with inline timestamp */}
          {showCaption && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {caption}
              {!isScheduled && !isVoiceType && <><TimeSpacer /><InlineTime message={message} isAI={isAI} isHuman={isHuman} tz={tz} /></>}
            </p>
          )}

          {/* Fallback: no media stored yet, show the placeholder text (skip voice — handled above) */}
          {isMediaType && !hasMedia && !isVoiceType && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.message_body}
              {!isScheduled && <><TimeSpacer /><InlineTime message={message} isAI={isAI} isHuman={isHuman} tz={tz} /></>}
            </p>
          )}

          {/* Regular text message (only when showCaption hasn't already rendered the body) */}
          {!isMediaType && !showCaption && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.message_body}
              {!isScheduled && <><TimeSpacer /><InlineTime message={message} isAI={isAI} isHuman={isHuman} tz={tz} /></>}
            </p>
          )}

          {/* Standalone time for media-only messages (no caption, non-voice) */}
          {!isScheduled && isMediaType && !isVoiceType && !showCaption && hasMedia && (
            <InlineTime message={message} isAI={isAI} isHuman={isHuman} tz={tz} standalone />
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
