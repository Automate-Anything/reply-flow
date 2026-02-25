import { useState, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useConversations, type Conversation } from '@/hooks/useConversations';
import { useMessages, type Message } from '@/hooks/useMessages';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationHeader from '@/components/inbox/ConversationHeader';
import MessageThread from '@/components/inbox/MessageThread';

export default function InboxPage() {
  const [search, setSearch] = useState('');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const { conversations, setConversations, loading: convsLoading, refetch: refetchConvs } = useConversations(search);
  const { messages, setMessages, loading: msgsLoading, sendMessage, markRead } = useMessages(
    activeConversation?.id ?? null
  );

  // Realtime updates
  useRealtimeMessages({
    onNewMessage: useCallback(
      (msg: Message) => {
        // Add to current thread if it matches
        if (activeConversation && msg.session_id === activeConversation.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          // Auto-mark as read if viewing this conversation
          markRead();
        }
        // Refresh conversation list to update last_message / unread counts
        refetchConvs();
      },
      [activeConversation, setMessages, markRead, refetchConvs]
    ),
    onSessionUpdate: useCallback(
      (session: Partial<Conversation> & { id: string }) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === session.id ? { ...c, ...session } : c))
        );
      },
      [setConversations]
    ),
  });

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversation(conv);
    // Mark as read when selecting
    if (conv.unread_count > 0) {
      api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
    }
  };

  const handleSend = async (body: string) => {
    try {
      await sendMessage(body);
      refetchConvs();
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleArchive = async () => {
    if (!activeConversation) return;
    try {
      await api.post(`/conversations/${activeConversation.id}/archive`, { archived: true });
      setActiveConversation(null);
      refetchConvs();
      toast.success('Conversation archived');
    } catch {
      toast.error('Failed to archive conversation');
    }
  };

  const handleBack = () => setActiveConversation(null);

  return (
    <div className="flex h-full">
      {/* Conversation list — hidden on mobile when a conversation is selected */}
      <div className={`${activeConversation ? 'hidden md:flex' : 'flex'} h-full w-full md:w-auto`}>
        <ConversationList
          conversations={conversations}
          loading={convsLoading}
          activeId={activeConversation?.id ?? null}
          onSelect={handleSelectConversation}
          search={search}
          onSearchChange={setSearch}
        />
      </div>

      {/* Message thread — full width on mobile */}
      {activeConversation ? (
        <div className={`${activeConversation ? 'flex' : 'hidden md:flex'} flex-1 flex-col`}>
          <ConversationHeader
            conversation={activeConversation}
            onArchive={handleArchive}
            onLabelsChange={refetchConvs}
            onBack={handleBack}
          />
          <MessageThread
            messages={messages}
            loading={msgsLoading}
            onSend={handleSend}
          />
        </div>
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MessageSquare className="h-7 w-7 opacity-40" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Select a conversation</p>
            <p className="mt-0.5 text-xs">Choose from the list to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
