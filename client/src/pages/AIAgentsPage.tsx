import { useState } from 'react';
import { usePageReady } from '@/hooks/usePageReady';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bot, Plus, Smartphone, ChevronDown, FileText, PenLine, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAgents } from '@/hooks/useAgents';
import { useSubscription } from '@/hooks/useSubscription';
import { PlanGate } from '@/components/auth/PlanGate';
import CreateFromLogsDialog from '@/components/agents/CreateFromLogsDialog';
import QuickSetupWizardDialog from '@/components/agents/QuickSetupWizardDialog';

export default function AIAgentsPage() {
  const navigate = useNavigate();
  const { agents, loading: agentsLoading, createAgent, generateFromLogs, generateFromWizard } = useAgents();
  const pageReady = usePageReady();
  const loading = agentsLoading || !pageReady;
  const { subscription, loading: subLoading } = useSubscription();
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

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
    <div className="mx-auto max-w-3xl space-y-6 p-6 animate-in fade-in duration-150">
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
        <PlanGate>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={atLimit || loading}
                title={atLimit ? `Agent limit reached (${agentLimit}). Upgrade your plan to add more.` : undefined}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Create Agent
                <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => setWizardOpen(true)} className="flex flex-col items-start gap-0.5 py-2.5">
                <span className="flex items-center font-medium">
                  <Wand2 className="mr-2 h-4 w-4" />
                  Guided setup
                </span>
                <span className="ml-6 text-xs text-muted-foreground">Answer a few questions and AI builds your agent for you</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreate} className="flex flex-col items-start gap-0.5 py-2.5">
                <span className="flex items-center font-medium">
                  <PenLine className="mr-2 h-4 w-4" />
                  Manual setup
                </span>
                <span className="ml-6 text-xs text-muted-foreground">Build your agent from scratch with full control over every scenario</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLogsDialogOpen(true)} className="flex flex-col items-start gap-0.5 py-2.5">
                <span className="flex items-center font-medium">
                  <FileText className="mr-2 h-4 w-4" />
                  Import from conversations
                </span>
                <span className="ml-6 text-xs text-muted-foreground">Upload past chats and AI learns your style and responses</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PlanGate>
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
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No agents yet</p>
            <p className="text-xs text-muted-foreground">
              Create your first AI agent to get started.
            </p>
            <PlanGate>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                <Button size="sm" onClick={() => setWizardOpen(true)} disabled={atLimit}>
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  Guided setup
                </Button>
                <Button size="sm" variant="outline" onClick={handleCreate} disabled={atLimit}>
                  <PenLine className="mr-1.5 h-4 w-4" />
                  Manual setup
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLogsDialogOpen(true)} disabled={atLimit}>
                  <FileText className="mr-1.5 h-4 w-4" />
                  Import from conversations
                </Button>
              </div>
            </PlanGate>
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

      <CreateFromLogsDialog
        open={logsDialogOpen}
        onOpenChange={setLogsDialogOpen}
        onGenerate={generateFromLogs}
        onCreate={async (body) => {
          const agent = await createAgent(body);
          navigate(`/ai-agents/${agent.id}`);
          return agent;
        }}
      />

      <QuickSetupWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onGenerate={generateFromWizard}
        onCreate={async (body) => {
          const agent = await createAgent(body);
          navigate(`/ai-agents/${agent.id}`);
          return agent;
        }}
      />
    </div>
  );
}
