import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { useGroups } from '@/hooks/useGroups';
import { useAlertRules } from '@/hooks/useAlertRules';
import { useMatchedMessages } from '@/hooks/useMatchedMessages';
import { useGroupRealtime } from '@/hooks/useGroupRealtime';
import { GroupsList } from '@/components/groups/GroupsList';
import { AlertRulesList } from '@/components/groups/AlertRulesList';
import { MatchedMessagesList } from '@/components/groups/MatchedMessagesList';

export default function GroupsPage() {
  const { groups, loading: groupsLoading, syncing, syncGroups, toggleMonitoring, bulkToggleMonitoring } =
    useGroups();
  const {
    rules,
    rawCriteria,
    loading: rulesLoading,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    refetch: refetchRules,
  } = useAlertRules(groups);
  const {
    matches,
    loading: matchesLoading,
    filterGroupId,
    filterCriteriaId,
    setFilterGroupId,
    setFilterCriteriaId,
    refetch: refetchMatches,
  } = useMatchedMessages();

  // Realtime updates for new matches
  useGroupRealtime({
    onNewMatch: () => {
      refetchMatches();
      refetchRules();
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Groups</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={syncGroups}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Groups
          </Button>
        </div>
      </div>

      <Tabs defaultValue="groups" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="groups">
              Groups{!groupsLoading && groups.length > 0 ? ` (${groups.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="rules">
              Alert Rules{!rulesLoading && rules.length > 0 ? ` (${rules.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="matches">Matched Messages</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="groups" className="flex-1 p-6">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">
              Choose which groups to watch. Only watched groups will have their messages scanned by your alert rules.
            </p>
          </div>
          <GroupsList
            groups={groups}
            loading={groupsLoading}
            toggleMonitoring={toggleMonitoring}
            bulkToggleMonitoring={bulkToggleMonitoring}
          />
        </TabsContent>

        <TabsContent value="rules" className="flex-1 p-6">
          <AlertRulesList
            rules={rules}
            groups={groups}
            loading={rulesLoading}
            onCreateRule={createRule}
            onUpdateRule={updateRule}
            onDeleteRule={deleteRule}
            onToggleRule={toggleRule}
          />
        </TabsContent>

        <TabsContent value="matches" className="flex-1 p-6">
          <p className="text-sm text-muted-foreground mb-4">
            Messages from watched groups that triggered your alert rules
          </p>
          <MatchedMessagesList
            matches={matches}
            groups={groups}
            criteria={rawCriteria}
            loading={matchesLoading}
            filterGroupId={filterGroupId}
            filterCriteriaId={filterCriteriaId}
            onFilterGroupChange={setFilterGroupId}
            onFilterCriteriaChange={setFilterCriteriaId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
