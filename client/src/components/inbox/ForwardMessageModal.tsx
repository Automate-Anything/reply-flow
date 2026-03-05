import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Forward, Search } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Message } from '@/hooks/useMessages';
import type { Conversation } from '@/hooks/useConversations';

interface ForwardMessageModalProps {
  message: Message | null;
  currentSessionId: string;
  conversations: Conversation[];
  onClose: () => void;
}

export default function ForwardMessageModal({
  message,
  currentSessionId,
  conversations,
  onClose,
}: ForwardMessageModalProps) {
  const [search, setSearch] = useState('');
  const [forwarding, setForwarding] = useState<string | null>(null);

  const targets = useMemo(() => {
    const filtered = conversations.filter((c) => c.id !== currentSessionId);
    if (!search) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (c) =>
        (c.contact_name || '').toLowerCase().includes(q) ||
        c.phone_number.includes(q)
    );
  }, [conversations, currentSessionId, search]);

  const handleForward = async (targetSessionId: string) => {
    if (!message || forwarding) return;
    setForwarding(targetSessionId);
    try {
      await api.post(`/messages/${message.id}/forward`, { targetSessionId });
      toast.success('Message forwarded');
      onClose();
    } catch {
      toast.error('Failed to forward message');
    } finally {
      setForwarding(null);
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="h-4 w-4" />
            Forward Message
          </DialogTitle>
        </DialogHeader>

        {/* Preview */}
        {message?.message_body && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="line-clamp-3 text-xs text-muted-foreground">
              {message.message_body}
            </p>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Contact list */}
        <div className="max-h-64 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No conversations found
            </p>
          ) : (
            <div className="space-y-0.5">
              {targets.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleForward(conv.id)}
                  disabled={forwarding === conv.id}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {((conv.contact_name || conv.phone_number)[0] || '?').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {conv.contact_name || conv.phone_number}
                    </p>
                    {conv.contact_name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {conv.phone_number}
                      </p>
                    )}
                  </div>
                  {forwarding === conv.id && (
                    <span className="text-xs text-muted-foreground">Sending...</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
