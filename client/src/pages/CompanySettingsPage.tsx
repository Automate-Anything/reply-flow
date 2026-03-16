import { useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CompanyInfoTab from './CompanyInfoTab';
import TeamPage from './TeamPage';
import RolePermissionsPage from './RolePermissionsPage';
import BillingTab from '@/components/settings/BillingTab';
import UsageTab from '@/components/settings/UsageTab';
import ConversationSettingsTab from '@/components/settings/ConversationSettingsTab';

const TABS = ['company', 'team', 'permissions', 'conversations', 'billing', 'usage'] as const;
type Tab = (typeof TABS)[number];

export default function CompanySettingsPage() {
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
          <h1 className="text-2xl font-semibold tracking-tight">Company Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your company, team, and billing.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="company" className="flex-1">Company</TabsTrigger>
          <TabsTrigger value="team" className="flex-1">Team</TabsTrigger>
          <TabsTrigger value="permissions" className="flex-1">Permissions</TabsTrigger>
          <TabsTrigger value="conversations" className="flex-1">Conversations</TabsTrigger>
          <TabsTrigger value="billing" className="flex-1">Billing</TabsTrigger>
          <TabsTrigger value="usage" className="flex-1">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6">
          <CompanyInfoTab />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <TeamPage />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <RolePermissionsPage />
        </TabsContent>

        <TabsContent value="conversations" className="mt-6">
          <ConversationSettingsTab />
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <BillingTab />
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <UsageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
