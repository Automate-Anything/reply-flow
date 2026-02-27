import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { SessionProvider } from '@/contexts/SessionContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';
import AuthPage from '@/pages/AuthPage';
import AuthCallback from '@/pages/AuthCallback';
import DashboardPage from '@/pages/DashboardPage';
import InboxPage from '@/pages/InboxPage';
import ContactsPage from '@/pages/ContactsPage';
import KnowledgeBasePage from '@/pages/KnowledgeBasePage';
import ProfileSettingsPage from '@/pages/ProfileSettingsPage';
import AcceptInvitePage from '@/pages/AcceptInvitePage';
import OnboardingPage from '@/pages/OnboardingPage';
import SettingsPage from '@/pages/SettingsPage';
import ChannelsPage from '@/pages/ChannelsPage';
import ChannelDetailPage from '@/components/settings/ChannelDetailView';


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
                <Route element={<AppLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="contacts" element={<ContactsPage />} />
                  <Route path="knowledge-base" element={<KnowledgeBasePage />} />
                  <Route path="channels" element={<ChannelsPage />} />
                  <Route path="channels/:channelId" element={<ChannelDetailPage />} />

                  <Route path="account" element={<SettingsPage />} />
                  <Route path="profile" element={<ProfileSettingsPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" richColors closeButton />
        </SessionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
