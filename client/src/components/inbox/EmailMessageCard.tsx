import { useState, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChevronDown, ChevronUp, Paperclip, MoreHorizontal, Reply, ReplyAll, Forward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/timezone';
import { useSession } from '@/contexts/SessionContext';
import type { Message } from '@/hooks/useMessages';
import type { EmailComposerMode } from './EmailComposer';

interface EmailMessageCardProps {
  message: Message;
  contactName?: string;
  channelEmail?: string;
  isLast?: boolean;
  onReplyAction?: (mode: EmailComposerMode, message: Message) => void;
}

export default function EmailMessageCard({ message, contactName, channelEmail, isLast, onReplyAction }: EmailMessageCardProps) {
  const [expanded, setExpanded] = useState(!!isLast);
  const [showRecipients, setShowRecipients] = useState(false);
  const { companyTimezone } = useSession();
  const meta = (message.metadata || {}) as Record<string, unknown>;

  const from = (meta.from as string) || (message.direction === 'inbound' ? contactName || 'Unknown' : 'You');
  const to = (meta.to as string) || (message.direction === 'outbound' ? contactName || '' : '');
  const cc = (meta.cc as string) || '';
  const htmlBody = (meta.html_body as string) || message.message_body || '';
  const attachments = (meta.attachments as Array<{ filename: string; mimeType?: string; size?: number }>) || [];

  const isOutbound = message.direction === 'outbound';

  // "to me, john" style collapsed recipient display
  const shortRecipients = useMemo(() => {
    const allTo = to.split(',').map(e => e.trim()).filter(Boolean);
    const self = (channelEmail || '').toLowerCase();
    const names = allTo.map(email => {
      if (email.toLowerCase().includes(self)) return 'me';
      const match = email.match(/^"?([^"<]+)"?\s*</);
      return match ? match[1].trim().split(' ')[0] : email.split('@')[0];
    });
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }, [to, channelEmail]);

  // Split body into new content and quoted reply chain
  const { mainHtml, quotedHtml } = useMemo(() => {
    const quotePatterns = [
      /<div class="gmail_quote">/i,
      /<blockquote[^>]*class="[^"]*gmail[^"]*"[^>]*>/i,
      /On .{10,80} wrote:/,
      /---------- Forwarded message ----------/,
      /<div[^>]*id="appendonsend"[^>]*>/i,
    ];

    let splitIdx = -1;
    for (const pattern of quotePatterns) {
      const match = htmlBody.search(pattern);
      if (match !== -1 && (splitIdx === -1 || match < splitIdx)) {
        splitIdx = match;
      }
    }

    if (splitIdx > 0) {
      return {
        mainHtml: htmlBody.substring(0, splitIdx),
        quotedHtml: htmlBody.substring(splitIdx),
      };
    }
    return { mainHtml: htmlBody, quotedHtml: '' };
  }, [htmlBody]);

  const [showQuoted, setShowQuoted] = useState(false);

  const sanitizedMain = DOMPurify.sanitize(mainHtml, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  });
  const sanitizedQuoted = quotedHtml ? DOMPurify.sanitize(quotedHtml, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  }) : '';

  const timestamp = message.message_ts || message.created_at;

  // Plain text preview from body (strip HTML)
  const plainPreview = htmlBody.replace(/<[^>]*>/g, '').trim().substring(0, 120);

  return (
    <div
      className={cn(
        'rounded-lg border bg-card transition-shadow',
        expanded && 'shadow-sm',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={isLast ? undefined : () => setExpanded((prev) => !prev)}
        className={cn(
          'flex w-full items-start gap-3 p-3 text-left transition-colors rounded-t-lg',
          !isLast && 'hover:bg-accent/30 cursor-pointer',
          isLast && 'cursor-default',
        )}
      >
        {/* Sender avatar */}
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white',
            isOutbound ? 'bg-primary' : 'bg-muted-foreground',
          )}
        >
          {from.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-sm font-medium">{from}</span>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatTime(timestamp, companyTimezone)}
            </span>
          </div>

          {/* Collapsed: show preview. Expanded: show "to me, john" */}
          {expanded ? (
            <div className="mt-0.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowRecipients(!showRecipients); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                to {shortRecipients}
                {(cc) && ', ...'}
                <ChevronDown className="inline h-3 w-3 ml-0.5" />
              </button>
              {showRecipients && (
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p><span className="text-foreground/70">To:</span> {to}</p>
                  {cc && <p><span className="text-foreground/70">CC:</span> {cc}</p>}
                </div>
              )}
            </div>
          ) : (
            <p className="truncate text-xs text-muted-foreground mt-0.5">
              {plainPreview || '(no content)'}
            </p>
          )}
        </div>

        {!isLast && (
          <div className="shrink-0 pt-0.5">
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-4 pb-3 pt-3">
          {/* Email body */}
          <div
            className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
            dangerouslySetInnerHTML={{ __html: sanitizedMain }}
          />

          {/* Quoted reply chain */}
          {sanitizedQuoted && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowQuoted(!showQuoted); }}
                className="mt-2 flex h-5 items-center rounded border px-2 text-muted-foreground hover:bg-accent/50 transition-colors"
                title={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showQuoted && (
                <div
                  className="mt-2 border-l-2 border-muted pl-3 prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_img]:rounded"
                  dangerouslySetInnerHTML={{ __html: sanitizedQuoted }}
                />
              )}
            </>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mt-3 space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
              </p>
              {attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{att.filename || 'Attachment'}</span>
                  {att.size && (
                    <span className="shrink-0 text-muted-foreground">
                      ({Math.round(att.size / 1024)} KB)
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Per-message Reply/Reply All/Forward buttons */}
          {onReplyAction && (
            <div className="mt-3 flex items-center gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onReplyAction('reply', message)}>
                <Reply className="mr-1 h-3.5 w-3.5" /> Reply
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onReplyAction('reply-all', message)}>
                <ReplyAll className="mr-1 h-3.5 w-3.5" /> Reply all
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onReplyAction('forward', message)}>
                <Forward className="mr-1 h-3.5 w-3.5" /> Forward
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
