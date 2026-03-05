import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Plus, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAgents } from '@/hooks/useAgents';
import { useSubscription } from '@/hooks/useSubscription';

export default function AIAgentsPage() {
  const navigate = useNavigate();
  const { agents, loading, createAgent } = useAgents();
  const { subscription, loading: subLoading } = useSubscription();

  const agentLimit = subscription?.plan.agents ?? Infinity;
  const atLimit = agents.length >= agentLimit;

  const handleCreate = async () => {
    try {
      const agent = await createAgent({ name: 'New Agent' });
      navigate(`/ai-agents/${agent.id}`);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 402) {
        toast.error(`Agent limit reached. Upgrade your plan to add more agents.`);
      } else {
        toast.error('Failed to create agent');
      }
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Agents</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage AI agents, then assign them to your channels.
          </p>
          {!subLoading && subscription && (
            <p className="mt-1 text-xs text-muted-foreground">
              {agents.length} / {agentLimit} agents used
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={atLimit || loading}
          title={atLimit ? `Agent limit reached (${agentLimit}). Upgrade your plan to add more.` : undefined}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Create Agent
        </Button>
      </div>

      {atLimit && !loading && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between py-3 px-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              You've reached the agent limit for your <span className="font-semibold">{subscription?.plan.name}</span> plan ({agentLimit} agent{agentLimit !== 1 ? 's' : ''}).
            </p>
            <Button size="sm" variant="outline" className="ml-4 shrink-0" onClick={() => navigate('/settings?tab=billing')}>
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No agents yet</p>
            <p className="text-xs text-muted-foreground">
              Create your first AI agent to get started.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={handleCreate} disabled={atLimit}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const useCase = agent.profile_data?.use_case;
            const businessName = agent.profile_data?.business_name;

            return (
              <Card
                key={agent.id}
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => navigate(`/ai-agents/${agent.id}`)}
              >
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        useCase && useCase.charAt(0).toUpperCase() + useCase.slice(1),
                        businessName,
                      ].filter(Boolean).join(' · ') || 'Not configured'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {agent.channel_count > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Smartphone className="mr-1 h-3 w-3" />
                        {agent.channel_count}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
