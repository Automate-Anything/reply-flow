import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GroupsList } from '@/components/groups/GroupsList';
import { GlobalCriteriaList } from '@/components/groups/GlobalCriteriaList';
import { GroupDetail } from '@/components/groups/GroupDetail';
import { useGroups } from '@/hooks/useGroups';

export default function GroupsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupFromUrl = searchParams.get('group');

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groupFromUrl);
  const { groups, loading: groupsLoading, toggleMonitoring } = useGroups();

  const selectGroup = (id: string | null) => {
    setSelectedGroupId(id);
    if (id) {
      setSearchParams({ group: id });
    } else {
      setSearchParams({});
    }
  };

  if (selectedGroupId) {
    return (
      <GroupDetail
        groupId={selectedGroupId}
        onBack={() => selectGroup(null)}
        groups={groups}
        groupsLoading={groupsLoading}
        toggleMonitoring={toggleMonitoring}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">Groups</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor WhatsApp group chats and configure alert criteria
        </p>
      </div>

      <Tabs defaultValue="groups" className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="global-criteria">Global Criteria</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="groups" className="flex-1 p-6">
          <GroupsList
            onSelectGroup={selectGroup}
            groups={groups}
            loading={groupsLoading}
            toggleMonitoring={toggleMonitoring}
          />
        </TabsContent>

        <TabsContent value="global-criteria" className="flex-1 p-6">
          <GlobalCriteriaList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
