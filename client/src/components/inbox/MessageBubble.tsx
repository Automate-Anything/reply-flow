import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { formatTime as formatTimestamp, formatScheduledTime } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import { AlertCircle, Check, CheckCheck, Clock, Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Mic, Pause, Pin, Play, Reply, Smile, Star, X } from 'lucide-react';
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
  contactAvatarUrl?: string | null;
  onCancelScheduled?: (messageId: string) => Promise<void>;
  onReply?: (message: Message) => void;
  onMessageUpdate?: (message: Message) => void;
  isDebugMode?: boolean;
}



interface GroupedReaction {
  emoji: string;
  count: number;
  isMine: boolean;
  reactors: Array<{ user_id: string; isMe: boolean }>;
}

function groupReactions(reactions: Array<{ emoji: string; user_id: string }>, myUserId: string | null): GroupedReaction[] {
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    const existing = map.get(r.emoji) || { emoji: r.emoji, count: 0, isMine: false, reactors: [] };
    existing.count += 1;
    // "self" comes from webhook echoes, UUID comes from app-initiated reactions
    const isMe = r.user_id === 'self' || !!(myUserId && r.user_id === myUserId);
    if (isMe) existing.isMine = true;
    existing.reactors.push({ user_id: r.user_id, isMe });
    map.set(r.emoji, existing);
  }
  return Array.from(map.values());
}

function ReactionDetailPopover({
  reaction,
  contactName,
  contactAvatar,
  userAvatar,
  onRemove,
  onClose,
  align,
}: {
  reaction: GroupedReaction;
  contactName?: string;
  contactAvatar?: string | null;
  userAvatar?: string | null;
  onRemove: () => void;
  onClose: () => void;
  align: 'left' | 'right';
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={cn(
        'absolute bottom-full z-50 mb-2 w-56 overflow-hidden rounded-xl border bg-background shadow-xl',
        align === 'right' ? 'right-0' : 'left-0'
      )}>
        {/* Tabs header */}
        <div className="flex gap-3 border-b px-3 pt-2">
          <button className="border-b-2 border-primary pb-1.5 text-xs font-medium">
            All {reaction.count}
          </button>
          <button className="border-b-2 border-primary pb-1.5 text-xs font-medium">
            {reaction.emoji} {reaction.count}
          </button>
        </div>

        {/* Reactor list */}
        <div className="p-2">
          {reaction.reactors.map((r) => {
            const name = r.isMe ? 'You' : (contactName || r.user_id);
            const avatar = r.isMe ? userAvatar : contactAvatar;
            const initial = (name[0] || '?').toUpperCase();

            return (
              <button
                key={r.user_id}
                onClick={r.isMe ? onRemove : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-2',
                  r.isMe && 'cursor-pointer hover:bg-accent'
                )}
              >
                {/* Avatar */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  {avatar ? (
                    <img src={avatar} alt={name} className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-primary">{initial}</span>
                  )}
                </div>

                {/* Name + subtitle */}
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{name}</p>
                  {r.isMe && (
                    <p className="text-[11px] text-muted-foreground">Click to remove</p>
                  )}
                </div>

                {/* Large emoji */}
                <span className="shrink-0 text-2xl">{reaction.emoji}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
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

  if (type === 'sticker') {
    return (
      <img
        src={mediaUrl}
        alt="Sticker"
        className="h-32 w-32 object-contain"
        loading="lazy"
      />
    );
  }

  if (type === 'image' || mime.startsWith('image/')) {
    return (
      <>
        <img
          src={mediaUrl}
          alt={message.media_filename || 'Image'}
          className="max-h-56 w-full cursor-pointer object-cover"
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
        className="max-h-80 w-full"
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
function TimeSpacer({ wide, hasStatus }: { wide?: boolean; hasStatus?: boolean }) {
  // wide: sender label (You/AI) adds ~30px; hasStatus: delivery icon adds ~16px
  const width = 75 + (wide ? 30 : 0) + (hasStatus ? 16 : 0);
  return <span className="inline-block" style={{ width }} />;
}

// Inline timestamp — absolutely positioned at bottom-right of the text container.
// The TimeSpacer inside the <p> reserves room so text doesn't overlap the timestamp.
// WhatsApp-style message delivery status icon
function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-3 w-3" />;
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

function InlineTime({ message, isAI, isHuman, isOutbound, tz, standalone }: {
  message: Message;
  isAI: boolean;
  isHuman: boolean;
  isOutbound: boolean;
  tz: string;
  standalone?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] leading-none opacity-60 whitespace-nowrap',
        standalone
          ? 'mt-1 justify-end w-full'
          : 'absolute bottom-[1px] right-0'
      )}
    >
      {isAI && <span className="font-medium uppercase tracking-wider">AI</span>}
      {isHuman && <span className="font-medium uppercase tracking-wider">You</span>}
      {(isAI || isHuman) && <span>·</span>}
      {message.is_pinned && <Pin className="h-2.5 w-2.5" />}
      {message.is_starred && <Star className="h-2.5 w-2.5 fill-current" />}
      <span>{formatTimestamp(message.message_ts || message.created_at, tz)}</span>
      {isOutbound && message.status !== 'scheduled' && <MessageStatusIcon status={message.status} />}
    </span>
  );
}

// ── Link preview card ────────────────────────────────────────────────────────

function LinkPreviewCard({ preview, isOutbound }: { preview: LinkPreview; isOutbound: boolean }) {
  const domain = preview.site_name || (() => {
    try { return new URL(preview.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();
  const isBase64 = preview.image?.startsWith('data:');

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
        isBase64 ? (
          // Whapi base64 thumbnails are tiny — show as blurred background with sharp overlay
          <div className="relative h-32 w-full overflow-hidden">
            <img
              src={preview.image}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
            />
            <img
              src={preview.image}
              alt=""
              className="relative mx-auto h-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
            />
          </div>
        ) : (
          <img
            src={preview.image}
            alt=""
            className="h-32 w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )
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

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageBubble({ message, messages = [], contactName, contactAvatarUrl, onCancelScheduled, onReply, onMessageUpdate, isDebugMode }: MessageBubbleProps) {
  const { companyTimezone: tz, avatarUrl: myAvatarUrl } = useSession();
  const isOutbound = message.direction === 'outbound';
  const isAI = message.sender_type === 'ai';
  const isHuman = message.sender_type === 'human';
  const isScheduled = message.status === 'scheduled' && message.scheduled_for;
  const reply = (message.metadata?.reply as ReplyMetadata) || null;
  const { userId: myUserId } = useSession();
  const reactions = groupReactions(message.reactions || [], myUserId);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [openReactionDetail, setOpenReactionDetail] = useState<string | null>(null);

  const handleReact = useCallback(async (emoji: string) => {
    if (reacting || !onMessageUpdate) return;
    setReacting(true);
    setShowEmojiBar(false);
    try {
      // Toggle: if I already reacted with this emoji, remove it; otherwise add it
      const myExisting = message.reactions?.find((r) => r.emoji === emoji && (r.user_id === myUserId || r.user_id === 'self'));
      const { data } = await api.post(`/messages/${message.id}/react`, {
        emoji: myExisting ? '' : emoji,
      });
      onMessageUpdate(data.message);
    } catch {
      // silently fail
    } finally {
      setReacting(false);
    }
  }, [message.id, message.reactions, myUserId, reacting, onMessageUpdate]);
  const debugData = isDebugMode && isAI ? (message.metadata?.debug as AIDebugData | undefined) : undefined;

  const hasMedia = !!message.media_storage_path;
  const { url: mediaUrl, loading: mediaLoading } = useMediaUrl(message);
  const isMediaType = ['image', 'video', 'audio', 'ptt', 'voice', 'document', 'sticker'].includes(message.message_type);
  const isVoiceType = ['audio', 'ptt', 'voice'].includes(message.message_type);
  const isVisualMedia = ['image', 'video', 'sticker'].includes(message.message_type) && hasMedia;
  const caption = message.message_body;
  // Don't show placeholder text as caption (e.g. "[Image]", "[Audio message]")
  const isPlaceholder = caption && /^\[.+\]$/.test(caption.trim());
  const showCaption = caption && !isPlaceholder;

  // Link preview: merge Whapi metadata with OG-fetched data
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
  // Also fetch OG tags — prefer OG image (higher res) over Whapi's base64 thumbnail
  const urlForOgFetch = !isMediaType
    ? (storedPreview?.url || (isPlaceholder ? null : caption))
    : null;
  const { preview: fetchedPreview } = useLinkPreview(urlForOgFetch);
  const linkPreview = hasStoredPreview
    ? {
        ...storedPreview!,
        image: fetchedPreview?.image || storedPreview!.image,
        title: storedPreview!.title || fetchedPreview?.title || null,
        description: storedPreview!.description || fetchedPreview?.description || null,
      }
    : fetchedPreview;

  return (
    <div
      data-component="MessageBubble"
      className={cn(
        'group/msg flex w-full items-center gap-1',
        isOutbound ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Action buttons — outbound messages: appears to the left */}
      {isOutbound && !isScheduled && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          {onMessageUpdate && (
            <div className="relative">
              <button
                onClick={() => setShowEmojiBar(!showEmojiBar)}
                className="rounded-full p-1 hover:bg-muted"
                title="React"
              >
                <Smile className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {showEmojiBar && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowEmojiBar(false)} />
                  <div className="absolute bottom-full right-0 z-50 mb-1 flex gap-0.5 rounded-full border bg-background px-1 py-0.5 shadow-lg">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReact(emoji)}
                        className="rounded-full px-1 py-0.5 text-base transition-transform hover:scale-125 hover:bg-accent"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {onReply && (
            <button
              onClick={() => onReply(message)}
              className="rounded-full p-1 hover:bg-muted"
              title="Reply"
            >
              <Reply className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      <div className={cn('max-w-[70%]', linkPreview && 'max-w-[340px]', isScheduled && 'group')}>
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
            'overflow-hidden rounded-2xl',
            message.message_type === 'sticker'
              ? 'bg-transparent p-0'
              : isVisualMedia ? 'p-0' : 'px-4 py-2',
            message.message_type !== 'sticker' && (
              isScheduled
                ? 'border border-dashed border-primary/30 bg-primary/5 text-foreground'
                : isOutbound
                  ? isAI
                    ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-100'
                    : 'bg-primary/90 text-primary-foreground'
                  : 'bg-muted text-foreground'
            )
          )}
        >
          {/* Quoted message preview (inside bubble) */}
          {reply && (
            <div
              className={cn(
                'mb-1.5 rounded-lg border-l-2 px-3 py-1.5 text-xs',
                isVisualMedia ? 'mx-2 mt-2' : '-mx-2',
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
            <div className={isVisualMedia ? 'relative' : 'mb-1'}>
              <MediaContent
                message={message}
                mediaUrl={mediaUrl}
                mediaLoading={mediaLoading}
                isOutbound={isOutbound}
                voiceTimeSlot={
                  isVoiceType && !isScheduled
                    ? <InlineTime message={message} isAI={isAI} isHuman={isHuman} isOutbound={isOutbound} tz={tz} />
                    : undefined
                }
              />
              {/* Gradient fade + overlay timestamp on image when no caption */}
              {isVisualMedia && !showCaption && !isScheduled && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
                  <span className="absolute bottom-1.5 right-2 inline-flex items-center gap-1 text-[10px] leading-none text-white drop-shadow-sm whitespace-nowrap">
                    {(isAI || isHuman) && <span className="font-medium uppercase tracking-wider">{isAI ? 'AI' : 'You'}</span>}
                    {(isAI || isHuman) && <span>·</span>}
                    <span>{formatTimestamp(message.message_ts || message.created_at, tz)}</span>
                    {isOutbound && message.status !== 'scheduled' && <MessageStatusIcon status={message.status} />}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Text body / caption — with inline timestamp */}
          {showCaption && (
            <div className={cn('relative', isVisualMedia && 'px-4 py-2')}>
              <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', linkPreview && 'break-all')}>{caption}{!isScheduled && !isVoiceType && <TimeSpacer wide={isAI || isHuman} hasStatus={isOutbound} />}</p>
              {!isScheduled && !isVoiceType && <InlineTime message={message} isAI={isAI} isHuman={isHuman} isOutbound={isOutbound} tz={tz} />}
            </div>
          )}

          {/* Fallback: no media stored yet, show the placeholder text (skip voice — handled above) */}
          {isMediaType && !hasMedia && !isVoiceType && (
            <div className="relative">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.message_body}{!isScheduled && <TimeSpacer wide={isAI || isHuman} hasStatus={isOutbound} />}</p>
              {!isScheduled && <InlineTime message={message} isAI={isAI} isHuman={isHuman} isOutbound={isOutbound} tz={tz} />}
            </div>
          )}

          {/* Regular text message (only when showCaption hasn't already rendered the body) */}
          {!isMediaType && !showCaption && (
            <div className="relative">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.message_body}{!isScheduled && <TimeSpacer wide={isAI || isHuman} hasStatus={isOutbound} />}</p>
              {!isScheduled && <InlineTime message={message} isAI={isAI} isHuman={isHuman} isOutbound={isOutbound} tz={tz} />}
            </div>
          )}

          {/* Standalone time for media-only messages (no caption, non-voice, non-visual) */}
          {!isScheduled && isMediaType && !isVoiceType && !isVisualMedia && !showCaption && hasMedia && (
            <InlineTime message={message} isAI={isAI} isHuman={isHuman} isOutbound={isOutbound} tz={tz} standalone />
          )}

        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className={cn('-mt-1 flex gap-0.5', isOutbound ? 'justify-end' : 'justify-start')}>
            {reactions.map((r) => (
              <div key={r.emoji} className="relative">
                <button
                  onClick={() => setOpenReactionDetail(openReactionDetail === r.emoji ? null : r.emoji)}
                  className={cn(
                    'rounded-full border px-1.5 py-0.5 text-xs shadow-sm transition-colors hover:bg-accent',
                    r.isMine
                      ? 'border-primary/50 bg-primary/10'
                      : 'bg-background'
                  )}
                >
                  {r.emoji}{r.count > 1 ? ` ${r.count}` : ''}
                </button>
                {openReactionDetail === r.emoji && (
                  <ReactionDetailPopover
                    reaction={r}
                    contactName={contactName}
                    contactAvatar={contactAvatarUrl}
                    userAvatar={myAvatarUrl}
                    onRemove={() => { setOpenReactionDetail(null); handleReact(r.emoji); }}
                    onClose={() => setOpenReactionDetail(null)}
                    align={isOutbound ? 'right' : 'left'}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* AI Debug Panel */}
        {debugData && <AIDebugPanel debugData={debugData} />}
      </div>

      {/* Action buttons — inbound messages: appears to the right */}
      {!isOutbound && !isScheduled && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          {onReply && (
            <button
              onClick={() => onReply(message)}
              className="rounded-full p-1 hover:bg-muted"
              title="Reply"
            >
              <Reply className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          {onMessageUpdate && (
            <div className="relative">
              <button
                onClick={() => setShowEmojiBar(!showEmojiBar)}
                className="rounded-full p-1 hover:bg-muted"
                title="React"
              >
                <Smile className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {showEmojiBar && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowEmojiBar(false)} />
                  <div className="absolute bottom-full left-0 z-50 mb-1 flex gap-0.5 rounded-full border bg-background px-1 py-0.5 shadow-lg">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReact(emoji)}
                        className="rounded-full px-1 py-0.5 text-base transition-transform hover:scale-125 hover:bg-accent"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
