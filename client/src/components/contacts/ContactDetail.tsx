import { useState, useEffect, useCallback, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ArrowLeft, Loader2, Pencil, Trash2, Phone, Mail, Building2, AlertTriangle, MapPin, MessageCircle, User, Hash, Clock, Brain, X, Calendar, MessageSquare, Tag, UserPlus, Upload, GitMerge, List, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { useContactActivity } from '@/hooks/useContactActivity';
import { useSingleContactDuplicates } from '@/hooks/useContactDuplicates';
import ActivityTimeline from './ActivityTimeline';
import ContactNotes from './ContactNotes';
import ContactConversations, { type ContactSession as ConvSession } from './ContactConversations';
import MergeContactDialog from './MergeContactDialog';
import type { Contact } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { CustomFieldValue } from '@/hooks/useCustomFields';
import type { ContactList } from '@/hooks/useContactLists';
import { PlanGate } from '@/components/auth/PlanGate';
import type { TimelineEvent } from '@/hooks/useContactActivity';

interface ContactSession {
  id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  channel_id: number | null;
  channel_name: string | null;
  message_count: number;
  memory_count: number;
}

interface ContactMemory {
  id: string;
  memory_type: string;
  content: string;
  session_id: string;
  is_active: boolean;
  created_at: string;
}

interface ContactDetailProps {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
  onBack?: () => void;
  availableTags?: ContactTag[];
  availableLists?: ContactList[];
  contactListIds?: string[];
  customFieldValues?: CustomFieldValue[];
  onRefresh?: () => void;
}

function getRecentEventIcon(event: TimelineEvent) {
  switch (event.type) {
    case 'message':
      return event.event === 'message_received'
        ? { icon: MessageSquare, color: 'text-blue-500' }
        : { icon: MessageSquare, color: 'text-green-500' };
    case 'activity':
      switch (event.event) {
        case 'created':
          return { icon: UserPlus, color: 'text-green-600' };
        case 'edited':
          return { icon: Pencil, color: 'text-gray-500' };
        case 'tag_added':
        case 'tag_removed':
          return { icon: Tag, color: 'text-purple-500' };
        case 'list_added':
        case 'list_removed':
          return { icon: List, color: 'text-indigo-500' };
        case 'imported':
          return { icon: Upload, color: 'text-blue-500' };
        case 'merged':
          return { icon: GitMerge, color: 'text-orange-500' };
        default:
          return { icon: Pencil, color: 'text-gray-500' };
      }
    default:
      return { icon: Pencil, color: 'text-gray-500' };
  }
}

function getRecentEventDescription(event: TimelineEvent): string {
  const data = event.data;
  const metadata = (data.metadata || {}) as Record<string, unknown>;

  switch (event.type) {
    case 'message': {
      const direction = event.event === 'message_received' ? 'Received' : 'Sent';
      const body = (data.message_body as string) || '';
      return body ? `${direction}: ${body}` : direction;
    }
    case 'activity':
      switch (event.event) {
        case 'created':
          return 'Contact created';
        case 'edited':
          return 'Contact edited';
        case 'tag_added':
          return `Tag added: ${metadata.tag || ''}`;
        case 'tag_removed':
          return `Tag removed: ${metadata.tag || ''}`;
        case 'list_added':
          return `Added to list${metadata.list_name ? `: ${metadata.list_name}` : ''}`;
        case 'list_removed':
          return `Removed from list${metadata.list_name ? `: ${metadata.list_name}` : ''}`;
        case 'imported':
          return 'Imported from CSV';
        case 'merged':
          return `Merged with ${(metadata.merged_contact_name as string) || 'another contact'}`;
        default:
          return event.event;
      }
    default:
      return event.event;
  }
}

export default function ContactDetail({
  contact,
  onEdit,
  onDelete,
  deleting,
  onBack,
  availableTags = [],
  availableLists = [],
  contactListIds = [],
  customFieldValues = [],
  onRefresh,
}: ContactDetailProps) {
  const {
    events, loading: activityLoading, hasMore, loadMore, loadingMore, refetch: refetchActivity,
  } = useContactActivity(contact.id);
  const { duplicates } = useSingleContactDuplicates(contact.id);
  const [mergeTarget, setMergeTarget] = useState<Contact | null>(null);
  const [sessions, setSessions] = useState<ContactSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [memories, setMemories] = useState<ContactMemory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const sessionsFetched = useRef(false);
  const memoriesFetched = useRef(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');

  // Reset fetch flags when contact changes
  useEffect(() => {
    sessionsFetched.current = false;
    memoriesFetched.current = false;
    setSessions([]);
    setMemories([]);
  }, [contact.id]);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contact.id}/sessions`);
      setSessions(data.sessions || []);
      sessionsFetched.current = true;
    } catch { /* ignore */ } finally {
      setSessionsLoading(false);
    }
  }, [contact.id]);

  const fetchMemories = useCallback(async () => {
    setMemoriesLoading(true);
    try {
      const { data } = await api.get(`/contacts/${contact.id}/memories`);
      setMemories(data.memories || []);
      memoriesFetched.current = true;
    } catch { /* ignore */ } finally {
      setMemoriesLoading(false);
    }
  }, [contact.id]);

  // Fetch sessions eagerly on mount; memories lazy on tab activation
  useEffect(() => {
    if (!sessionsFetched.current && !sessionsLoading) fetchSessions();
    if (activeTab === 'memories' && !memoriesFetched.current && !memoriesLoading) fetchMemories();
  }, [activeTab, sessionsLoading, fetchSessions, memoriesLoading, fetchMemories]);

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    || contact.whatsapp_name
    || contact.phone_number;

  const tagColorMap = new Map(availableTags.map((t) => [t.name, t.color]));

  const hasAddress = contact.address_street || contact.address_city || contact.address_state
    || contact.address_postal_code || contact.address_country;

  const handleMergeComplete = () => {
    setMergeTarget(null);
    refetchActivity();
    onRefresh?.();
  };

  const handleSaveMemory = async (memoryId: string) => {
    try {
      await api.patch(`/contacts/${contact.id}/memories/${memoryId}`, { content: editingMemoryContent });
      setMemories(prev => prev.map(m => m.id === memoryId ? { ...m, content: editingMemoryContent } : m));
      setEditingMemoryId(null);
    } catch { /* ignore */ }
  };

  // Quick Stats computed from sessions
  const totalMessages = sessions.reduce((sum, s) => sum + s.message_count, 0);
  const lastActive = sessions.map(s => s.last_message_at).filter(Boolean).sort().reverse()[0];
  const lastActiveLabel = lastActive ? formatTimeAgo(lastActive) : 'Never';

  // Recent activity (non-note events, first 3)
  const recentEvents = events.filter(e => e.type !== 'note').slice(0, 3);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-4 md:px-6">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-semibold">
            {(contact.first_name?.[0] || contact.phone_number[0] || '?').toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{name}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {contact.phone_number}
              </span>
              {contact.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contact.email}
                </span>
              )}
              {contact.company && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {contact.company}
                </span>
              )}
              <span className="text-muted-foreground/50">·</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Created {new Date(contact.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PlanGate>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
          </PlanGate>
          <PlanGate>
            <ConfirmDialog
              title={`Delete ${name}?`}
              description="This will delete the contact and all associated data. This action cannot be undone."
              onConfirm={onDelete}
              loading={deleting}
            >
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </ConfirmDialog>
          </PlanGate>
        </div>
      </div>

      {/* Duplicate warning banner */}
      {duplicates.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-yellow-50 px-6 py-2 dark:bg-yellow-950/30">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
          <span className="text-xs text-yellow-800 dark:text-yellow-200">
            {duplicates.length} potential duplicate{duplicates.length !== 1 ? 's' : ''} found
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto px-1 py-0 text-xs text-yellow-800 underline dark:text-yellow-200"
            onClick={() => setMergeTarget(duplicates[0].contact)}
          >
            Review
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-4 w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="memories">Memories</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-auto px-6 py-4">
          {/* Quick Stats bar */}
          <div className="mb-4 flex items-center gap-6 rounded-lg bg-muted/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold">{totalMessages}</p>
                <p className="text-xs text-muted-foreground">Messages</p>
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold">{sessions.length}</p>
                <p className="text-xs text-muted-foreground">Conversations</p>
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold">{lastActiveLabel}</p>
                <p className="text-xs text-muted-foreground">Last active</p>
              </div>
            </div>
          </div>

          {/* Details card */}
          <div className="max-w-lg rounded-lg border bg-card">
            {/* Contact methods */}
            <DetailSection title="Contact">
              <DetailField icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={contact.phone_number} />
              <DetailField icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} />
              <DetailField icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp" value={contact.whatsapp_name} />
            </DetailSection>

            {/* Personal / work — always show */}
            <DetailSection title="Personal">
              <DetailField icon={<User className="h-3.5 w-3.5" />} label="First Name" value={contact.first_name} />
              <DetailField icon={<User className="h-3.5 w-3.5" />} label="Last Name" value={contact.last_name} />
              <DetailField icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={contact.company} />
            </DetailSection>

            {/* Tags */}
            {contact.tags.length > 0 && (
              <DetailSection title="Tags">
                <div className="flex flex-wrap gap-1 px-4 py-2.5">
                  {contact.tags.map((tagName) => {
                    const color = tagColorMap.get(tagName);
                    return (
                      <Badge
                        key={tagName}
                        variant={color ? 'default' : 'secondary'}
                        className="text-xs"
                        style={color ? { backgroundColor: color, color: 'white' } : undefined}
                      >
                        {tagName}
                      </Badge>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Lists */}
            {contactListIds.length > 0 && (
              <DetailSection title="Lists">
                <div className="flex flex-wrap gap-1 px-4 py-2.5">
                  {contactListIds.map((listId) => {
                    const list = availableLists.find((l) => l.id === listId);
                    if (!list) return null;
                    return (
                      <Badge
                        key={listId}
                        variant="outline"
                        className="text-xs"
                      >
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                        {list.name}
                      </Badge>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Notes */}
            {contact.notes && (
              <DetailSection title="Notes">
                <p className="px-4 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">{contact.notes}</p>
              </DetailSection>
            )}

            {/* Address */}
            {hasAddress && (
              <DetailSection title="Address">
                <div className="flex gap-2 px-4 py-2.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm leading-relaxed">
                    {[
                      contact.address_street,
                      [contact.address_city, contact.address_state, contact.address_postal_code].filter(Boolean).join(', '),
                      contact.address_country,
                    ].filter(Boolean).join('\n')}
                  </p>
                </div>
              </DetailSection>
            )}

            {/* Custom Fields */}
            {customFieldValues.length > 0 && (
              <DetailSection title="Additional">
                {customFieldValues.map((cfv) => (
                  <DetailField
                    key={cfv.id}
                    icon={<Hash className="h-3.5 w-3.5" />}
                    label={cfv.field_definition.name}
                    value={
                      cfv.field_definition.field_type === 'multi_select'
                        ? (cfv.value_json || []).join(', ')
                        : cfv.value
                    }
                  />
                ))}
              </DetailSection>
            )}
          </div>

          {/* Recent Activity preview */}
          {recentEvents.length > 0 && (
            <div className="mt-4 max-w-lg rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h4>
              </div>
              <div className="divide-y">
                {recentEvents.map((event, idx) => {
                  const { icon: Icon, color } = getRecentEventIcon(event);
                  const description = getRecentEventDescription(event);
                  return (
                    <div key={`${event.type}-${event.data.id || idx}`} className="flex items-center gap-3 px-4 py-2.5">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
                      <span className="min-w-0 flex-1 truncate text-sm">{description}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatTimeAgo(event.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t px-4 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setActiveTab('activity')}
                >
                  View all activity
                  <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="flex-1 overflow-auto px-6 py-4">
          <ActivityTimeline
            events={events.filter(e => e.type !== 'note')}
            loading={activityLoading}
            hasMore={hasMore}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
          />
        </TabsContent>

        <TabsContent value="conversations" className="flex-1 overflow-auto px-6 py-4">
          <ContactConversations
            contactId={contact.id}
            sessions={sessions as ConvSession[]}
            sessionsLoading={sessionsLoading}
          />
        </TabsContent>

        <TabsContent value="notes" className="flex-1 overflow-auto px-6 py-4">
          <ContactNotes contactId={contact.id} />
        </TabsContent>

        <TabsContent value="memories" className="flex-1 overflow-auto px-6 py-4">
          {memoriesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : memories.length === 0 ? (
            <div className="py-8 text-center">
              <Brain className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No memories yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Memories are extracted automatically when sessions end.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((m) => {
                const typeConfig: Record<string, { label: string; color: string }> = {
                  preference: { label: 'Preference', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
                  fact: { label: 'Fact', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300' },
                  decision: { label: 'Decision', color: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' },
                  issue: { label: 'Issue', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
                  summary: { label: 'Summary', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' },
                };
                const cfg = typeConfig[m.memory_type] || { label: m.memory_type, color: 'bg-gray-100 text-gray-800' };
                const ago = formatTimeAgo(m.created_at);
                const isEditing = editingMemoryId === m.id;

                return (
                  <div key={m.id} className="group flex items-start gap-2 rounded-lg border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{ago}</span>
                      </div>
                      {isEditing ? (
                        <div className="mt-1 space-y-2">
                          <textarea
                            value={editingMemoryContent}
                            onChange={(e) => setEditingMemoryContent(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleSaveMemory(m.id)}
                              disabled={!editingMemoryContent.trim()}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingMemoryId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-sm leading-relaxed">{m.content}</p>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          title="Edit memory"
                          onClick={() => {
                            setEditingMemoryId(m.id);
                            setEditingMemoryContent(m.content);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          title="Remove memory"
                          onClick={async () => {
                            try {
                              await api.patch(`/contacts/${contact.id}/memories/${m.id}`, { is_active: false });
                              setMemories((prev) => prev.filter((x) => x.id !== m.id));
                            } catch { /* ignore */ }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Merge dialog */}
      {mergeTarget && (
        <MergeContactDialog
          open={!!mergeTarget}
          onOpenChange={(open) => !open && setMergeTarget(null)}
          contactA={contact}
          contactB={mergeTarget}
          onMergeComplete={handleMergeComplete}
        />
      )}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function DetailField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{value || '\u2014'}</span>
    </div>
  );
}
