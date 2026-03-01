import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Plus, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAgents } from '@/hooks/useAgents';

export default function AIAgentsPage() {
  const navigate = useNavigate();
  const { agents, loading, createAgent } = useAgents();

  const handleCreate = async () => {
    try {
      const agent = await createAgent({ name: 'New Agent' });
      navigate(`/ai-agents/${agent.id}`);
    } catch {
      toast.error('Failed to create agent');
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
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Create Agent
        </Button>
      </div>

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
            <Button size="sm" variant="outline" className="mt-2" onClick={handleCreate}>
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
