import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, CalendarClock, ChevronDown, Clock, MessageSquare, UserCheck } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { getChannelConfig } from '@/lib/channelTypes';
import { usePageReady } from '@/hooks/usePageReady';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversations, type Conversation, type ConversationFilters } from '@/hooks/useConversations';
import { useMessages, type Message } from '@/hooks/useMessages';
import { useScheduledMessages } from '@/hooks/useScheduledMessages';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useConversationStatuses } from '@/hooks/useConversationStatuses';
import { useConversationPriorities } from '@/hooks/useConversationPriorities';
import ConversationList from '@/components/inbox/ConversationList';
import ConversationHeader from '@/components/inbox/ConversationHeader';
import MessageThread from '@/components/inbox/MessageThread';
import ConversationNotes from '@/components/inbox/ConversationNotes';
import ContactPanel from '@/components/inbox/ContactPanel';
import InboxToolsPanel from '@/components/inbox/InboxToolsPanel';
import ForwardMessageModal from '@/components/inbox/ForwardMessageModal';
import ScheduledMessagesList from '@/components/inbox/ScheduledMessagesList';
import { useDebugMode } from '@/hooks/useDebugMode';
import { useClassificationSuggestions } from '@/hooks/useClassificationSuggestions';

type InboxTab = 'all' | 'assigned' | 'snoozed' | 'scheduled' | 'archived';

export default function InboxPage() {
  const pageReady = usePageReady();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<InboxTab>(() => {
    const t = searchParams.get('tab');
    if (t === 'snoozed' || t === 'scheduled' || t === 'assigned' || t === 'archived') return t;
    return 'all';
  });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ConversationFilters>({});
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const restoredConvRef = useRef(false);
  const [pendingConvId, setPendingConvId] = useState<string | null>(() => {
    return searchParams.get('conversation') || null;
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const [inboxToolsOpen, setInboxToolsOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [priorityMetadataNeeded, setPriorityMetadataNeeded] = useState(false);
  const [assignedUnreadCount, setAssignedUnreadCount] = useState(0);
  const needsConversationSupport = activeTab !== 'scheduled' || !!activeConversation;
  const { debugMode } = useDebugMode(needsConversationSupport);
  const { hasPending } = useClassificationSuggestions(activeConversation?.id ?? null);
  const [contactPanelTab, setContactPanelTab] = useState<'info' | 'notes' | 'ai'>('info');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [connectedChannelTypes, setConnectedChannelTypes] = useState<string[]>([]);

  // Fetch connected channel types for the channel tabs
  useEffect(() => {
    api.get('/conversations/channel-types')
      .then(res => setConnectedChannelTypes(res.data))
      .catch(() => setConnectedChannelTypes(['whatsapp']));
  }, []);

  // Draft persistence
  const draftRef = useRef<string>('');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge tab-specific filters
  const effectiveFilters = useMemo(() => {
    const base = { ...filters };
    if (channelFilter !== 'all') {
      base.channel_type = channelFilter as 'whatsapp' | 'email';
    }
    if (activeTab === 'snoozed') return { ...base, snoozed: true };
    if (activeTab === 'assigned') return { ...base, assignee: ['me'] };
    if (activeTab === 'archived') return { ...base, archived: true };
    return base;
  }, [activeTab, filters, channelFilter]);

  const { conversations, setConversations, loading: convsLoading, refetch: refetchConvs } =
    useConversations(search, effectiveFilters);
  const { messages, setMessages, loading: msgsLoading, sendMessage, sendVoiceNote, scheduleMessage, cancelScheduledMessage, markRead } = useMessages(
    activeConversation?.id ?? null
  );

  const {
    scheduledMessages,
    loading: scheduledLoading,
    updateMessage: updateScheduledMessage,
    cancelMessage: cancelScheduledMsg,
  } = useScheduledMessages(activeTab === 'scheduled');
  const { members: teamMembers } = useTeamMembers(needsConversationSupport);
  const { statuses: conversationStatuses } = useConversationStatuses(needsConversationSupport);
  const { priorities: conversationPriorities } = useConversationPriorities(
    needsConversationSupport && priorityMetadataNeeded
  );

  // Fetch labels for bulk actions
  const refreshLabels = useCallback(() => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  }, []);

  useEffect(() => {
    refreshLabels();
  }, [refreshLabels]);

  // Fetch assigned unread count for the badge
  useEffect(() => {
    api.get('/conversations?assignee=me&unread=true&limit=0')
      .then(({ data }) => setAssignedUnreadCount(data.count || 0))
      .catch(() => {});
  }, [conversations]);

  // Restore active conversation from sessionStorage on first load
  useEffect(() => {
    if (restoredConvRef.current || convsLoading || conversations.length === 0) return;
    restoredConvRef.current = true;
    const savedId = sessionStorage.getItem('reply-flow-active-conversation');
    if (savedId) {
      const conv = conversations.find((c) => c.id === savedId);
      if (conv) {
        draftRef.current = conv.draft_message || '';
        setActiveConversation(conv);
        if (conv.unread_count > 0 || conv.marked_unread) {
          api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
        }
      }
    }
  }, [conversations, convsLoading, refetchConvs]);

  // Persist active conversation id to sessionStorage
  useEffect(() => {
    if (activeConversation) {
      sessionStorage.setItem('reply-flow-active-conversation', activeConversation.id);
    } else {
      sessionStorage.removeItem('reply-flow-active-conversation');
    }
  }, [activeConversation]);

  // Capture notification deep-link params from URL into state, then clean URL.
  // Using state (pendingConvId) ensures the target survives URL cleanup and
  // triggers the resolve effect below even if conversations haven't reloaded yet.
  useEffect(() => {
    const t = searchParams.get('tab');
    const convParam = searchParams.get('conversation');

    let changed = false;
    if (t === 'snoozed' || t === 'scheduled' || t === 'assigned' || t === 'archived') {
      setActiveTab(t);
      changed = true;
    }
    if (convParam) {
      setPendingConvId(convParam);
      changed = true;
    }

    if (changed) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('tab');
      newParams.delete('conversation');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Resolve pending conversation selection once conversations have loaded.
  // If the conversation isn't in the current filtered list (e.g. it's snoozed
  // but user is on the "all" tab), fall back to a direct API fetch.
  useEffect(() => {
    if (!pendingConvId || convsLoading) return;

    const targetId = pendingConvId;
    const conv = conversations.find((c) => c.id === targetId);

    if (conv) {
      setPendingConvId(null);
      draftRef.current = conv.draft_message || '';
      setActiveConversation(conv);
      if (conv.unread_count > 0 || conv.marked_unread) {
        api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
      }
      return;
    }

    // Not in the current filtered list — fetch the conversation directly
    setPendingConvId(null);
    api.get(`/conversations/${targetId}`).then(({ data }) => {
      if (data.session) {
        draftRef.current = data.session.draft_message || '';
        setActiveConversation(data.session);
        if (data.session.unread_count > 0 || data.session.marked_unread) {
          api.post(`/conversations/${targetId}/read`).then(() => refetchConvs());
        }
      }
    }).catch(() => {});
  }, [pendingConvId, conversations, convsLoading, refetchConvs]);

  // Fetch profile picture if the active conversation has a contact but no picture yet
  const fetchedPicForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversation?.contact_id) return;
    if (activeConversation.profile_picture_url) return;
    // Don't re-fetch for the same contact
    if (fetchedPicForRef.current === activeConversation.contact_id) return;
    fetchedPicForRef.current = activeConversation.contact_id;

    api.get(`/contacts/${activeConversation.contact_id}`).then(({ data }) => {
      const url = data.contact?.profile_picture_url;
      if (url) {
        setActiveConversation((prev) =>
          prev && prev.id === activeConversation.id ? { ...prev, profile_picture_url: url } : prev
        );
        // Also update the conversations list so the sidebar shows the picture
        setConversations((prev) =>
          prev.map((c) => c.id === activeConversation.id ? { ...c, profile_picture_url: url } : c)
        );
      }
    }).catch(() => { /* silently fail */ });
  }, [activeConversation, setConversations]);

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
        if (activeConversation && msg.session_id === activeConversation.id) {
          setMessages((prev) => {
            // Already have this exact message
            if (prev.some((m) => m.id === msg.id)) return prev;
            // If this is an outbound message and we have a pending temp message,
            // skip — the sendMessage response handler will replace the temp message
            if (
              msg.direction === 'outbound' &&
              msg.sender_type === 'human' &&
              prev.some((m) => m.id.startsWith('temp-') && m.session_id === msg.session_id)
            ) {
              return prev;
            }
            return [...prev, msg];
          });
          markRead();
        }
        refetchConvs();
      },
      [activeConversation, setMessages, markRead, refetchConvs]
    ),
    onMessageUpdate: useCallback(
      (msg: Partial<Message> & { id: string }) => {
        // Merge updated fields (e.g. media_storage_path after voice note processing)
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
        );
      },
      [setMessages]
    ),
    onSessionUpdate: useCallback(
      (session: Partial<Conversation> & { id: string }) => {
        // Realtime payload only has raw chat_sessions columns — preserve joined fields
        // (profile_picture_url from contacts, labels from conversation_labels, assigned_user from users)
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== session.id) return c;
            return {
              ...c,
              ...session,
              profile_picture_url: c.profile_picture_url,
              labels: c.labels,
              assigned_user: c.assigned_user,
              contact_session_count: c.contact_session_count,
            };
          })
        );
        setActiveConversation((prev) => {
          if (!prev || prev.id !== session.id) return prev;
          return {
            ...prev,
            ...session,
            profile_picture_url: prev.profile_picture_url,
            labels: prev.labels,
            assigned_user: prev.assigned_user,
            contact_session_count: prev.contact_session_count,
          };
        });
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
      // Optimistically clear unread state so the badge disappears instantly,
      // even if the user clicks away before the API responds.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id ? { ...c, unread_count: 0, marked_unread: false } : c
        )
      );
      setActiveConversation((prev) =>
        prev && prev.id === conv.id
          ? { ...prev, unread_count: 0, marked_unread: false }
          : prev
      );
      api.post(`/conversations/${conv.id}/read`).then(() => refetchConvs());
    }
  };

  const handleSend = async (body: string): Promise<{ compliance?: { warnings: string[]; remaining: number; limit: number; resetsAt: string } } | void> => {
    // Clear draft timer BEFORE the async send — otherwise the pending timer
    // can fire during the await and re-save the draft to the server after
    // the send endpoint already cleared it.
    draftRef.current = '';
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    if (activeConversation) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, draft_message: null, unread_count: 0, marked_unread: false } : c))
      );
    }

    // Build reply metadata for optimistic message display
    const replyMeta = replyingTo
      ? {
          reply: {
            quoted_message_id: replyingTo.id,
            quoted_content: (replyingTo.message_body || '').slice(0, 200),
            quoted_sender: replyingTo.sender_type,
            quoted_type: replyingTo.message_type,
          },
        }
      : undefined;
    const quotedId = replyingTo?.id;
    setReplyingTo(null);

    try {
      const result = await sendMessage(body, quotedId, replyMeta);
      refetchConvs();
      return result ? { compliance: result.compliance } : undefined;
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleSendVoiceNote = async (blob: Blob, duration: number) => {
    try {
      await sendVoiceNote(blob, duration);
      refetchConvs();
    } catch {
      toast.error('Failed to send voice note');
    }
  };

  const handleSendEmail = async (data: { htmlBody: string; textBody: string; subject: string; cc: string[]; bcc: string[] }) => {
    if (!activeConversation) return;
    try {
      await api.post('/messages/send-email', {
        sessionId: activeConversation.id,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        subject: data.subject,
        cc: data.cc,
        bcc: data.bcc,
      });
      refetchConvs();
      toast.success('Email sent');
    } catch {
      toast.error('Failed to send email');
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

  const channelTabBar = connectedChannelTypes.length > 1 ? (
    <div className="flex border-b px-2 gap-1">
      <button
        className={cn('px-3 py-1.5 text-sm font-medium rounded-t',
          channelFilter === 'all' ? 'bg-background border-b-2 border-primary' : 'text-muted-foreground'
        )}
        onClick={() => setChannelFilter('all')}
      >
        All Channels
      </button>
      {connectedChannelTypes.map(type => {
        const config = getChannelConfig(type);
        const Icon = config.icon;
        return (
          <button
            key={type}
            className={cn('px-3 py-1.5 text-sm font-medium rounded-t flex items-center gap-1.5',
              channelFilter === type ? 'bg-background border-b-2 border-primary' : 'text-muted-foreground'
            )}
            onClick={() => setChannelFilter(type)}
          >
            <Icon className="h-3.5 w-3.5" />
            {config.label}
          </button>
        );
      })}
    </div>
  ) : null;

  const tabBar = (
    <div className="flex items-center gap-1">
      {([
        { key: 'all', label: 'All', icon: MessageSquare },
        { key: 'assigned', label: 'Assigned to Me', icon: UserCheck },
      ] as const).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            activeTab === key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
          {key === 'assigned' && assignedUnreadCount > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {assignedUnreadCount > 99 ? '99+' : assignedUnreadCount}
            </span>
          )}
        </button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'snoozed' || activeTab === 'scheduled' || activeTab === 'archived'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
            )}
          >
            {activeTab === 'snoozed' && <><Clock className="h-3.5 w-3.5 shrink-0" />Snoozed</>}
            {activeTab === 'scheduled' && <><CalendarClock className="h-3.5 w-3.5 shrink-0" />Scheduled</>}
            {activeTab === 'archived' && <><Archive className="h-3.5 w-3.5 shrink-0" />Archived</>}
            {activeTab !== 'snoozed' && activeTab !== 'scheduled' && activeTab !== 'archived' && 'More'}
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setActiveTab('snoozed')}>
            <Clock className="mr-2 h-4 w-4" />
            Snoozed
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setActiveTab('scheduled'); setActiveConversation(null); }}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Scheduled
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActiveTab('archived')}>
            <Archive className="mr-2 h-4 w-4" />
            Archived
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const combinedTabBar = (
    <>
      {channelTabBar}
      {tabBar}
    </>
  );

  if (!pageReady) {
    return (
      <div className="flex h-full" data-component="InboxPage">
        <div className="flex h-full w-full flex-col border-r md:w-[320px]">
          <div className="border-b px-3 pt-3 pb-2 space-y-2">
            {/* Search bar + filter buttons */}
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-9 flex-1 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
            </div>
            {/* Tab bar */}
            <div className="flex items-center gap-1">
              <Skeleton className="h-7 w-14 rounded-md" />
              <Skeleton className="h-7 w-20 rounded-md" />
              <Skeleton className="h-7 w-24 rounded-md" />
            </div>
          </div>
          {/* Conversation items */}
          <div className="flex-1 space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </div>
        {/* Right panel placeholder */}
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-muted-foreground md:flex">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-1.5 text-center">
            <Skeleton className="mx-auto h-4 w-36" />
            <Skeleton className="mx-auto h-3 w-52" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full animate-in fade-in duration-150" data-component="InboxPage">
      {/* Left panel */}
      <div className={`${activeConversation && showConversationList ? 'hidden md:flex' : 'flex'} h-full w-full shrink-0 flex-col border-r md:w-[320px]`}>
        <div className="min-h-0 flex-1">
          {activeTab === 'scheduled' ? (
            <ScheduledMessagesList
              messages={scheduledMessages}
              loading={scheduledLoading}
              onUpdate={updateScheduledMessage}
              onCancel={cancelScheduledMsg}
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onFiltersChange={setFilters}
              statuses={conversationStatuses}
              priorities={conversationPriorities}
              onPriorityMetadataNeeded={() => setPriorityMetadataNeeded(true)}
              tabBar={combinedTabBar}
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
              priorities={conversationPriorities}
              onPriorityMetadataNeeded={() => setPriorityMetadataNeeded(true)}
              tabBar={combinedTabBar}
            />
          )}
        </div>
      </div>

      {/* Right panel: message thread + notes */}
      {activeConversation ? (
        <>
          <div className={`${activeConversation ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
            <ConversationHeader
              conversation={activeConversation}
              onArchive={handleArchive}
              onLabelsChange={refetchConvs}
              onBack={handleBack}
              onConversationUpdate={handleConversationUpdate}
              teamMembers={teamMembers}
              statuses={conversationStatuses}
              priorities={conversationPriorities}
              onPriorityMetadataNeeded={() => setPriorityMetadataNeeded(true)}
              onOpenContact={() => setContactPanelOpen(true)}
              onToggleNotes={() => setNotesPanelOpen((prev) => !prev)}
              notesPanelOpen={notesPanelOpen}
              onLabelsCreated={refreshLabels}
              onOpenClassification={() => {
                setContactPanelTab('ai');
                setContactPanelOpen(true);
              }}
              hasPendingSuggestions={hasPending}
            />
            <MessageThread
              messages={messages}
              loading={msgsLoading}
              sessionId={activeConversation.id}
              channelId={activeConversation.channel_id ?? undefined}
              channelType={activeConversation.channel_type ?? undefined}
              contactName={activeConversation.contact_name || activeConversation.phone_number}
              contactAvatarUrl={activeConversation.profile_picture_url}
              contactEmail={activeConversation.channel_type === 'email' ? activeConversation.phone_number : undefined}
              onSend={handleSend}
              onSendEmail={activeConversation.channel_type === 'email' ? handleSendEmail : undefined}
              onSendVoiceNote={handleSendVoiceNote}
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
            sessionId={activeConversation.id}
            open={contactPanelOpen}
            onClose={() => {
              setContactPanelOpen(false);
              setContactPanelTab('info');
            }}
            initialTab={contactPanelTab}
            previewName={activeConversation.contact_name}
            previewPhone={activeConversation.phone_number}
            previewPicture={activeConversation.profile_picture_url}
            onProfilePictureLoaded={(url) => {
              setActiveConversation((prev) =>
                prev && !prev.profile_picture_url ? { ...prev, profile_picture_url: url } : prev
              );
              setConversations((prev) =>
                prev.map((c) => c.id === activeConversation.id && !c.profile_picture_url ? { ...c, profile_picture_url: url } : c)
              );
            }}
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
            ) : activeTab === 'archived' ? (
              <Archive className="h-7 w-7 opacity-40" />
            ) : (
              <MessageSquare className="h-7 w-7 opacity-40" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {activeTab === 'scheduled'
                ? 'Manage scheduled messages'
                : activeTab === 'archived'
                  ? 'Archived conversations'
                  : 'Select a conversation'}
            </p>
            <p className="mt-0.5 text-xs">
              {activeTab === 'scheduled'
                ? 'Edit or cancel messages from the list'
                : activeTab === 'archived'
                  ? 'Select a conversation to view its history'
                  : 'Choose from the list to start messaging'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
