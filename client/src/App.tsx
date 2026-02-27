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
import SettingsPage from '@/pages/SettingsPage';
import TeamPage from '@/pages/TeamPage';
import RolePermissionsPage from '@/pages/RolePermissionsPage';
import CompanySettingsPage from '@/pages/CompanySettingsPage';
import ProfileSettingsPage from '@/pages/ProfileSettingsPage';
import AcceptInvitePage from '@/pages/AcceptInvitePage';
import OnboardingPage from '@/pages/OnboardingPage';

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
                  <Route path="channels" element={<SettingsPage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route path="team/permissions" element={<RolePermissionsPage />} />
                  <Route path="settings/company" element={<CompanySettingsPage />} />
                  <Route path="settings/profile" element={<ProfileSettingsPage />} />
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
