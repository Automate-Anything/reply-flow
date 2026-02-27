import { useState, useEffect, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useConversations, type Conversation, type ConversationFilters } from '@/hooks/useConversations';
import { useMessages, type Message } from '@/hooks/useMessages';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationHeader from '@/components/inbox/ConversationHeader';
import MessageThread from '@/components/inbox/MessageThread';
import ConversationNotes from '@/components/inbox/ConversationNotes';
import ContactPanel from '@/components/inbox/ContactPanel';

export default function InboxPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ConversationFilters>({});
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);

  const { conversations, setConversations, loading: convsLoading, refetch: refetchConvs } =
    useConversations(search, filters);
  const { messages, setMessages, loading: msgsLoading, sendMessage, markRead } = useMessages(
    activeConversation?.id ?? null
  );
  const { members: teamMembers } = useTeamMembers();

  // Fetch labels for bulk actions
  useEffect(() => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  }, []);

  // Realtime updates
  useRealtimeMessages({
    onNewMessage: useCallback(
      (msg: Message) => {
        if (activeConversation && msg.session_id === activeConversation.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          markRead();
        }
        refetchConvs();
      },
      [activeConversation, setMessages, markRead, refetchConvs]
    ),
    onSessionUpdate: useCallback(
      (session: Partial<Conversation> & { id: string }) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === session.id ? { ...c, ...session } : c))
        );
        setActiveConversation((prev) =>
          prev && prev.id === session.id ? { ...prev, ...session } : prev
        );
      },
      [setConversations]
    ),
  });

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversation(conv);
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

  const handleConversationUpdate = (updated: Conversation) => {
    setActiveConversation(updated);
    setConversations((prev) =>
      prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
    );
  };

  const handleBack = () => setActiveConversation(null);

  // Selection handlers
  const handleToggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedIds([]);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(conversations.map((c) => c.id));
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const handleBulkActionComplete = () => {
    refetchConvs();
    setSelectedIds([]);
  };

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className={`${activeConversation ? 'hidden md:flex' : 'flex'} h-full w-full md:w-auto`}>
        <ConversationList
          conversations={conversations}
          loading={convsLoading}
          activeId={activeConversation?.id ?? null}
          onSelect={handleSelectConversation}
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
          selectionMode={selectionMode}
          onToggleSelectionMode={handleToggleSelectionMode}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onBulkActionComplete={handleBulkActionComplete}
          teamMembers={teamMembers}
          labels={allLabels}
        />
      </div>

      {/* Message thread + notes panel */}
      {activeConversation ? (
        <>
          <div className={`${activeConversation ? 'flex' : 'hidden md:flex'} flex-1 flex-col`}>
            <ConversationHeader
              conversation={activeConversation}
              onArchive={handleArchive}
              onLabelsChange={refetchConvs}
              onBack={handleBack}
              onConversationUpdate={handleConversationUpdate}
              teamMembers={teamMembers}
              onOpenContact={() => setContactPanelOpen(true)}
              onToggleNotes={() => setNotesPanelOpen((prev) => !prev)}
              notesPanelOpen={notesPanelOpen}
            />
            <MessageThread
              messages={messages}
              loading={msgsLoading}
              onSend={handleSend}
            />
          </div>

          {/* Notes side panel */}
          {notesPanelOpen && (
            <div className="hidden md:flex">
              <ConversationNotes
                sessionId={activeConversation.id}
                onClose={() => setNotesPanelOpen(false)}
              />
            </div>
          )}

          {/* Contact slide-over */}
          <ContactPanel
            contactId={activeConversation.contact_id}
            open={contactPanelOpen}
            onClose={() => setContactPanelOpen(false)}
          />
        </>
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
