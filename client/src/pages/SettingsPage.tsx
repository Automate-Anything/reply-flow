import { useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CompanySettingsPage from './CompanySettingsPage';
import TeamPage from './TeamPage';
import WorkspacesPage from './WorkspacesPage';
import RolePermissionsPage from './RolePermissionsPage';

const TABS = ['company', 'team', 'workspaces', 'permissions'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'company';

  const handleTabChange = (value: string) => {
    setSearchParams(value === 'company' ? {} : { tab: value }, { replace: true });
  };

  return (
    <div className={`mx-auto space-y-6 p-6 ${activeTab === 'permissions' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your company, team, and workspaces.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="company" className="flex-1">Company</TabsTrigger>
          <TabsTrigger value="team" className="flex-1">Team</TabsTrigger>
          <TabsTrigger value="workspaces" className="flex-1">Workspaces</TabsTrigger>
          <TabsTrigger value="permissions" className="flex-1">Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6">
          <CompanySettingsPage />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <TeamPage />
        </TabsContent>

        <TabsContent value="workspaces" className="mt-6">
          <WorkspacesPage />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <RolePermissionsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
