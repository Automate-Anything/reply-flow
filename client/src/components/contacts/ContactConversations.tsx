import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Brain, Clock, Loader2, MessageSquare } from 'lucide-react';
import api from '@/lib/api';
import type { Message } from '@/hooks/useMessages';
import ReadOnlyMessageList from './ReadOnlyMessageList';

export interface ContactSession {
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

interface ContactConversationsProps {
  contactId: string;
  sessions: ContactSession[];
  sessionsLoading: boolean;
}

// ── Session list view ────────────────────────────────────────────────────────

function SessionCard({
  session,
  index,
  total,
  onClick,
}: {
  session: ContactSession;
  index: number;
  total: number;
  onClick: () => void;
}) {
  const started = new Date(session.created_at);
  const ended = session.ended_at ? new Date(session.ended_at) : null;
  const isActive = !ended;

  const durationMs = ended
    ? ended.getTime() - started.getTime()
    : Date.now() - started.getTime();
  const durationHours = Math.round(durationMs / (1000 * 60 * 60));
  const durationLabel =
    durationHours < 1 ? '< 1h' : durationHours < 24 ? `${durationHours}h` : `${Math.round(durationHours / 24)}d`;

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
            {isActive ? 'Active' : session.status}
          </Badge>
          <span className="text-xs text-muted-foreground">#{total - index}</span>
          {session.channel_name && (
            <span className="text-xs text-muted-foreground">{session.channel_name}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {durationLabel}
          </span>
          {session.memory_count > 0 && (
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3" />
              {session.memory_count}
            </span>
          )}
        </div>
      </div>

      <div className="mt-1.5 text-xs text-muted-foreground">
        {started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        {ended
          ? ` — ${ended.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
          : ' — now'}
      </div>

      {session.last_message && (
        <p className="mt-1 truncate text-xs text-foreground/70">{session.last_message}</p>
      )}
    </div>
  );
}

// ── Message thread view ──────────────────────────────────────────────────────

function MessageThread({ session, onBack }: { session: ContactSession; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/conversations/${session.id}/messages`);
      setMessages(data.messages || []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const started = new Date(session.created_at);
  const ended = session.ended_at ? new Date(session.ended_at) : null;
  const isActive = !ended;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-2 py-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
          {isActive ? 'Active' : session.status}
        </Badge>
        {session.channel_name && (
          <span className="text-sm text-muted-foreground">{session.channel_name}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          {ended
            ? ` — ${ended.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
            : ' — now'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4">
        <ReadOnlyMessageList messages={messages} loading={loading} />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ContactConversations({
  contactId: _contactId,
  sessions,
  sessionsLoading,
}: ContactConversationsProps) {
  const [selectedSession, setSelectedSession] = useState<ContactSession | null>(null);

  if (selectedSession) {
    return (
      <MessageThread session={selectedSession} onBack={() => setSelectedSession(null)} />
    );
  }

  if (sessionsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="py-8 text-center">
        <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session, i) => (
        <SessionCard
          key={session.id}
          session={session}
          index={i}
          total={sessions.length}
          onClick={() => setSelectedSession(session)}
        />
      ))}
    </div>
  );
}
