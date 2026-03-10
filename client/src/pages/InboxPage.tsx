import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CalendarClock, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useConversations, type Conversation, type ConversationFilters } from '@/hooks/useConversations';
import { useMessages, type Message } from '@/hooks/useMessages';
import { useScheduledMessages } from '@/hooks/useScheduledMessages';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useConversationStatuses } from '@/hooks/useConversationStatuses';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationHeader from '@/components/inbox/ConversationHeader';
import MessageThread from '@/components/inbox/MessageThread';
import ConversationNotes from '@/components/inbox/ConversationNotes';
import ContactPanel from '@/components/inbox/ContactPanel';
import InboxToolsPanel from '@/components/inbox/InboxToolsPanel';
import ForwardMessageModal from '@/components/inbox/ForwardMessageModal';
import ScheduledMessagesList from '@/components/inbox/ScheduledMessagesList';
import { useDebugMode } from '@/hooks/useDebugMode';

type InboxTab = 'all' | 'snoozed' | 'scheduled';

export default function InboxPage() {
  const [activeTab, setActiveTab] = useState<InboxTab>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ConversationFilters>({});
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const [inboxToolsOpen, setInboxToolsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const { debugMode } = useDebugMode();

  // Draft persistence
  const draftRef = useRef<string>('');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge snoozed filter when on snoozed tab
  const effectiveFilters = useMemo(() => {
    if (activeTab === 'snoozed') return { ...filters, snoozed: true };
    return filters;
  }, [activeTab, filters]);

  const { conversations, setConversations, loading: convsLoading, refetch: refetchConvs } =
    useConversations(search, effectiveFilters);
  const { messages, setMessages, loading: msgsLoading, sendMessage, scheduleMessage, cancelScheduledMessage, markRead } = useMessages(
    activeConversation?.id ?? null
  );

  console.log('[InboxPage render] messages count:', messages.length, 'ids:', messages.map(m => m.id));
  const {
    scheduledMessages,
    loading: scheduledLoading,
    updateMessage: updateScheduledMessage,
    cancelMessage: cancelScheduledMsg,
  } = useScheduledMessages();
  const { members: teamMembers } = useTeamMembers();
  const { statuses: conversationStatuses } = useConversationStatuses();

  // Fetch labels for bulk actions
  const refreshLabels = useCallback(() => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  }, []);

  useEffect(() => {
    refreshLabels();
  }, [refreshLabels]);

  // Draft save helper
  const saveDraft = useCallback(async (sessionId: string, text: string) => {
    try {
      await api.patch(`/conversations/${sessionId}`, { draft_message: text });
    } catch {
      // Silently fail — drafts are a convenience, not critical
    }
  }, []);

  const handleDraftChange = useCallback((text: string) => {
    draftRef.current = text;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const convId = activeConversation?.id;
    if (convId) {
      draftTimerRef.current = setTimeout(() => {
        saveDraft(convId, text);
      }, 2000);
    }
  }, [activeConversation?.id, saveDraft]);

  // Save draft on unmount (page navigation)
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  // Realtime updates
  useRealtimeMessages({
    onNewMessage: useCallback(
      (msg: Message) => {
        console.log('[onNewMessage] fired for msg:', msg.id, 'session:', msg.session_id, 'active:', activeConversation?.id);
        if (activeConversation && msg.session_id === activeConversation.id) {
          setMessages((prev) => {
            const isDupe = prev.some((m) => m.id === msg.id);
            console.log('[onNewMessage] adding to thread, isDupe:', isDupe, 'prevCount:', prev.length);
            if (isDupe) return prev;
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
    // Save draft for the conversation we're leaving
    if (activeConversation && draftRef.current !== (activeConversation.draft_message || '')) {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      saveDraft(activeConversation.id, draftRef.current);
      const savedDraft = draftRef.current.trim() || null;
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, draft_message: savedDraft } : c))
      );
    }

    // Init draft ref for the new conversation
    draftRef.current = conv.draft_message || '';

    setActiveConversation(conv);
    setReplyingTo(null);
    if (conv.unread_count > 0 || conv.marked_unread) {
      api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
    }
  };

  const handleSend = async (body: string) => {
    try {
      await sendMessage(body, replyingTo?.id);
      setReplyingTo(null);

      // Clear draft (server also clears it atomically on send)
      draftRef.current = '';
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (activeConversation) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversation.id ? { ...c, draft_message: null } : c))
        );
      }

      refetchConvs();
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleSchedule = async (body: string, scheduledFor: string) => {
    try {
      await scheduleMessage(body, scheduledFor);
      toast.success('Message scheduled');
    } catch {
      toast.error('Failed to schedule message');
    }
  };

  const handleCancelScheduled = async (messageId: string) => {
    try {
      await cancelScheduledMessage(messageId);
      toast.success('Scheduled message cancelled');
    } catch {
      toast.error('Failed to cancel scheduled message');
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

  const handleBack = () => {
    // Save draft before leaving
    if (activeConversation && draftRef.current) {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      saveDraft(activeConversation.id, draftRef.current);
      const savedDraft = draftRef.current.trim() || null;
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, draft_message: savedDraft } : c))
      );
    }
    draftRef.current = '';
    setActiveConversation(null);
  };

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

  const handleMessageUpdate = (updatedMsg: Message) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
    );
  };

  const showConversationList = activeTab !== 'scheduled';

  const tabBar = (
    <div className="flex items-center gap-1">
      {([
        { key: 'all', label: 'All', icon: MessageSquare },
        { key: 'snoozed', label: 'Snoozed', icon: Clock },
        { key: 'scheduled', label: 'Scheduled', icon: CalendarClock },
      ] as const).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => {
            setActiveTab(key);
            if (key === 'scheduled') setActiveConversation(null);
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            activeTab === key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full" data-component="InboxPage">
      {/* Left panel */}
      <div className={`${activeConversation && showConversationList ? 'hidden md:flex' : 'flex'} h-full w-full flex-col border-r md:w-[320px]`}>
        <div className="min-h-0 flex-1">
          {activeTab === 'scheduled' ? (
            <ScheduledMessagesList
              messages={scheduledMessages}
              loading={scheduledLoading}
              onUpdate={updateScheduledMessage}
              onCancel={cancelScheduledMsg}
              tabBar={tabBar}
            />
          ) : inboxToolsOpen ? (
            <InboxToolsPanel onClose={() => setInboxToolsOpen(false)} />
          ) : (
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
              onRefresh={refetchConvs}
              teamMembers={teamMembers}
              labels={allLabels}
              onLabelsCreated={refreshLabels}
              onOpenInboxTools={() => setInboxToolsOpen(true)}
              statuses={conversationStatuses}
              tabBar={tabBar}
            />
          )}
        </div>
      </div>

      {/* Right panel: message thread + notes */}
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
              statuses={conversationStatuses}
              onOpenContact={() => setContactPanelOpen(true)}
              onToggleNotes={() => setNotesPanelOpen((prev) => !prev)}
              notesPanelOpen={notesPanelOpen}
              onLabelsCreated={refreshLabels}
            />
            <MessageThread
              messages={messages}
              loading={msgsLoading}
              sessionId={activeConversation.id}
              onSend={handleSend}
              onSchedule={handleSchedule}
              onCancelScheduled={handleCancelScheduled}
              initialDraft={activeConversation?.draft_message || ''}
              onDraftChange={handleDraftChange}
              replyingTo={replyingTo}
              onReply={setReplyingTo}
              onCancelReply={() => setReplyingTo(null)}
              onMessageUpdate={handleMessageUpdate}
              onForward={setForwardingMessage}
              isDebugMode={debugMode}
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

          {/* Forward message modal */}
          <ForwardMessageModal
            message={forwardingMessage}
            currentSessionId={activeConversation.id}
            conversations={conversations}
            onClose={() => setForwardingMessage(null)}
          />
        </>
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            {activeTab === 'scheduled' ? (
              <CalendarClock className="h-7 w-7 opacity-40" />
            ) : (
              <MessageSquare className="h-7 w-7 opacity-40" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {activeTab === 'scheduled'
                ? 'Manage scheduled messages'
                : 'Select a conversation'}
            </p>
            <p className="mt-0.5 text-xs">
              {activeTab === 'scheduled'
                ? 'Edit or cancel messages from the list'
                : 'Choose from the list to start messaging'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
