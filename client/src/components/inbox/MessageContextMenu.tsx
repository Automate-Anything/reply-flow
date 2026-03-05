import { useState } from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import { Copy, Forward, NotebookPen, Pin, Reply, Smile, Star } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Message } from '@/hooks/useMessages';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface MessageContextMenuProps {
  children: React.ReactNode;
  message: Message;
  sessionId: string;
  onReply: (message: Message) => void;
  onMessageUpdate: (message: Message) => void;
  onForward: (message: Message) => void;
}

export default function MessageContextMenu({
  children,
  message,
  sessionId,
  onReply,
  onMessageUpdate,
  onForward,
}: MessageContextMenuProps) {
  const [acting, setActing] = useState(false);
  const isScheduled = message.status === 'scheduled';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.message_body || '');
    toast.success('Copied to clipboard');
  };

  const handleStar = async () => {
    if (acting) return;
    setActing(true);
    try {
      const { data } = await api.post(`/messages/${message.id}/star`);
      onMessageUpdate(data.message);
    } catch {
      toast.error('Failed to star message');
    } finally {
      setActing(false);
    }
  };

  const handlePin = async () => {
    if (acting) return;
    setActing(true);
    try {
      const { data } = await api.post(`/messages/${message.id}/pin`);
      onMessageUpdate(data.message);
    } catch {
      toast.error('Failed to pin message');
    } finally {
      setActing(false);
    }
  };

  const handleReact = async (emoji: string) => {
    if (acting) return;
    setActing(true);
    try {
      // If user already reacted with this emoji, remove it
      const existing = message.reactions?.find(
        (r) => r.emoji === emoji
      );
      const { data } = await api.post(`/messages/${message.id}/react`, {
        emoji: existing ? '' : emoji,
      });
      onMessageUpdate(data.message);
    } catch {
      toast.error('Failed to react');
    } finally {
      setActing(false);
    }
  };

  const handleAddToNote = async () => {
    if (!message.message_body) return;
    try {
      await api.post(`/conversation-notes/${sessionId}`, {
        content: message.message_body,
      });
      toast.success('Added to notes');
    } catch {
      toast.error('Failed to add to notes');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {!isScheduled && (
          <>
            <ContextMenuItem onClick={() => onReply(message)}>
              <Reply className="mr-2 h-4 w-4" />
              Reply
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Smile className="mr-2 h-4 w-4" />
                React
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="p-1">
                <div className="flex gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(emoji)}
                      className="rounded p-1.5 text-lg hover:bg-accent transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleStar}>
              <Star className={`mr-2 h-4 w-4 ${message.is_starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              {message.is_starred ? 'Unstar' : 'Star'}
            </ContextMenuItem>
            <ContextMenuItem onClick={handlePin}>
              <Pin className={`mr-2 h-4 w-4 ${message.is_pinned ? 'fill-current' : ''}`} />
              {message.is_pinned ? 'Unpin' : 'Pin'}
            </ContextMenuItem>
            {message.message_body && (
              <ContextMenuItem onClick={handleAddToNote}>
                <NotebookPen className="mr-2 h-4 w-4" />
                Add to Note
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />

            <ContextMenuItem onClick={() => onForward(message)}>
              <Forward className="mr-2 h-4 w-4" />
              Forward
            </ContextMenuItem>
          </>
        )}
        {isScheduled && (
          <ContextMenuItem onClick={handleCopy}>
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
