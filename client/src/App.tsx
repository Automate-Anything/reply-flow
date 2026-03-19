import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { SessionProvider } from '@/contexts/SessionContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';
import { PlanProvider } from '@/contexts/PlanContext';
import AuthPage from '@/pages/AuthPage';
import AuthCallback from '@/pages/AuthCallback';
import DashboardPage from '@/pages/DashboardPage';
import InboxPage from '@/pages/InboxPage';
import ContactsPage from '@/pages/ContactsPage';
import KnowledgeBasePage from '@/pages/KnowledgeBasePage';
import ProfileSettingsPage from '@/pages/ProfileSettingsPage';
import AcceptInvitePage from '@/pages/AcceptInvitePage';
import OnboardingPage from '@/pages/OnboardingPage';
import CompanySettingsPage from '@/pages/CompanySettingsPage';
import ChannelsPage from '@/pages/ChannelsPage';
import ChannelDetailPage from '@/components/settings/ChannelDetailView';
import AIAgentsPage from '@/pages/AIAgentsPage';
import AgentDetailPage from '@/pages/AgentDetailPage';
import SuperAdminPage from '@/pages/SuperAdminPage';
import BillingPage from '@/pages/BillingPage';
import GroupsPage from '@/pages/GroupsPage';
import DebugOverlay from '@/components/debug/DebugOverlay';

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <SessionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/invite/:token" element={<AcceptInvitePage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="plans" element={<BillingPage />} />
                <Route element={<PlanProvider><AppLayout /></PlanProvider>}>
                  <Route index element={<DashboardPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="contacts" element={<ContactsPage />} />
                  <Route path="knowledge-base" element={<KnowledgeBasePage />} />
                  <Route path="ai-agents" element={<AIAgentsPage />} />
                  <Route path="ai-agents/:agentId" element={<AgentDetailPage />} />
                  <Route path="channels" element={<ChannelsPage />} />
                  <Route path="channels/:channelId" element={<ChannelDetailPage />} />
                  <Route path="whatsapp-groups" element={<GroupsPage />} />

                  <Route path="company-settings" element={<CompanySettingsPage />} />
                  <Route path="profile-settings" element={<ProfileSettingsPage />} />
                  <Route path="super-admin" element={<SuperAdminPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" richColors closeButton />
          <DebugOverlay />
        </SessionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
