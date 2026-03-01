import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Bot, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAgent } from '@/hooks/useAgents';
import type { ProfileData } from '@/hooks/useCompanyAI';
import AIAgentSections from '@/components/settings/AIAgentSections';
import api from '@/lib/api';

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agent, loading, updateAgent } = useAgent(agentId);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = useCallback(
    async (updates: { profile_data: ProfileData }) => {
      await updateAgent(updates);
    },
    [updateAgent]
  );

  const handleNameSave = async () => {
    if (!nameValue.trim()) return;
    try {
      await updateAgent({ name: nameValue.trim() });
      toast.success('Agent name updated');
    } catch {
      toast.error('Failed to update name');
    }
    setEditingName(false);
  };

  const handleDelete = async () => {
    if (!agentId) return;
    setDeleting(true);
    try {
      await api.delete(`/agents/${agentId}`);
      toast.success('Agent deleted');
      navigate('/ai-agents');
    } catch {
      toast.error('Failed to delete agent');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <p className="text-sm text-muted-foreground">Agent not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/ai-agents')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/ai-agents')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-8 text-sm font-semibold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSave();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
              <Button size="sm" variant="outline" className="h-8" onClick={handleNameSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingName(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setNameValue(agent.name);
                setEditingName(true);
              }}
              className="text-left"
            >
              <h2 className="text-lg font-semibold hover:text-primary transition-colors">
                {agent.name}
              </h2>
            </button>
          )}
          {agent.channel_count > 0 && (
            <p className="text-xs text-muted-foreground">
              Assigned to {agent.channel_count} channel{agent.channel_count !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Agent Settings */}
      <AIAgentSections
        profileData={agent.profile_data}
        onSave={handleSave}
        agentId={agentId}
      />

      {/* Delete */}
      <div className="border-t pt-4">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Delete this agent? Channels using it will lose their AI configuration.
            </span>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
              {deleting ? 'Deleting...' : 'Confirm'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete Agent
          </Button>
        )}
      </div>
    </div>
  );
}
