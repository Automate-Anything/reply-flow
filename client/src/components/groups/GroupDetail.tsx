import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroupCriteria } from '@/hooks/useGroupCriteria';
import { useGroupMessages } from '@/hooks/useGroupMessages';
import { useGroupRealtime } from '@/hooks/useGroupRealtime';
import { CriteriaCard } from './CriteriaCard';
import { CriteriaDialog } from './CriteriaDialog';
import type { GroupChat, GroupCriteria, GroupChatMessage } from '@/types/groups';

interface GroupDetailProps {
  groupId: string;
  onBack: () => void;
  groups: GroupChat[];
  groupsLoading: boolean;
  toggleMonitoring: (groupId: string, enabled: boolean) => void;
}

export function GroupDetail({ groupId, onBack, groups, groupsLoading, toggleMonitoring }: GroupDetailProps) {
  const group = groups.find((g) => g.id === groupId);
  const { criteria, createCriteria, updateCriteria, deleteCriteria } =
    useGroupCriteria(groupId);
  const { matches, loading: messagesLoading, setMessages, setMatches } =
    useGroupMessages(groupId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GroupCriteria | null>(null);

  // Real-time: append new messages and matches as they arrive
  useGroupRealtime({
    onNewMessage: (msg) => {
      if (msg.group_chat_id === groupId) {
        setMessages((prev) => [msg, ...prev]);
      }
    },
    onNewMatch: (match) => {
      setMatches((prev) => [match, ...prev]);
    },
  });

  if (groupsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="mt-4 text-muted-foreground">Group not found.</p>
      </div>
    );
  }

  const handleSave = async (values: Partial<GroupCriteria>) => {
    if (editing) {
      await updateCriteria(editing.id, values);
    } else {
      await createCriteria(values);
    }
    setEditing(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Groups
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {group.group_name || group.group_jid}
            </h1>
            <p className="text-sm text-muted-foreground">{group.group_jid}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Monitoring</span>
            <Switch
              checked={group.monitoring_enabled}
              onCheckedChange={(enabled) => toggleMonitoring(group.id, enabled)}
            />
          </div>
        </div>
      </div>

      {/* Content tabs */}
      <Tabs defaultValue="criteria" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="criteria">Criteria</TabsTrigger>
            <TabsTrigger value="messages">Matched Messages</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="criteria" className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Group Criteria</h2>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Criteria
            </Button>
          </div>

          {criteria.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No criteria configured for this group.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {criteria.map((c) => (
                <CriteriaCard
                  key={c.id}
                  criteria={c}
                  onEdit={() => { setEditing(c); setDialogOpen(true); }}
                  onDelete={() => deleteCriteria(c.id)}
                  onToggle={(enabled) => updateCriteria(c.id, { is_enabled: enabled })}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="flex-1 p-6">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : matches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No matched messages yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {matches.map((match) =>
                match.group_chat_messages ? (
                  <MatchedMessageRow key={match.id} message={match.group_chat_messages} />
                ) : null
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CriteriaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        criteria={editing}
        onSave={handleSave}
      />
    </div>
  );
}

function MatchedMessageRow({ message }: { message: GroupChatMessage }) {
  return (
    <div className="p-4 border rounded-lg border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm">
          {message.sender_name || message.sender_phone || 'Unknown'}
        </span>
        {message.sender_phone && message.sender_name && (
          <span className="text-xs text-muted-foreground">{message.sender_phone}</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm">{message.message_body}</p>
    </div>
  );
}
