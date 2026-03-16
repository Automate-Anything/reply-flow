import { useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { usePortalData } from './hooks/usePortalData';
import { Header } from './components/layout/Header';
import { TabNav } from './components/layout/TabNav';
import { LoginForm } from './components/auth/LoginForm';
import { SignupForm } from './components/auth/SignupForm';
import { ForgotPasswordForm } from './components/auth/ForgotPasswordForm';
import { ResetPasswordForm } from './components/auth/ResetPasswordForm';
import { PendingReviewScreen } from './components/auth/PendingReviewScreen';
import { RejectedScreen } from './components/auth/RejectedScreen';
import { DashboardTab } from './tabs/DashboardTab';
import { ReferralsTab } from './tabs/ReferralsTab';
import { CommissionsTab } from './tabs/CommissionsTab';
import { PayoutsTab } from './tabs/PayoutsTab';
import { MarketingTab } from './tabs/MarketingTab';
import { SettingsTab } from './tabs/SettingsTab';
import { logout } from './api';

// H13: Extract reset token from URL at module load time (before any render)
// and immediately clear it from the URL to prevent leaking via Referer header.
const extractedResetToken = (() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return token;
})();

export default function App() {
  const auth = useAuth();
  const onAuthFail = useCallback(() => auth.setIsAuthed(false), [auth.setIsAuthed]);
  const portal = usePortalData(auth.isAuthed, onAuthFail);

  const handleLogout = useCallback(async () => {
    await auth.handleLogout();
    portal.clearData();
  }, [auth, portal]);

  // M14: Auto-logout after 30 minutes of inactivity
  useEffect(() => {
    if (!auth.isAuthed) return;
    const TIMEOUT = 30 * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        await logout();
        auth.setIsAuthed(false);
        portal.clearData();
      }, TIMEOUT);
    };
    const events: (keyof WindowEventMap)[] = ['click', 'keypress', 'scroll', 'mousemove', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      clearTimeout(timeoutId);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [auth.isAuthed]);

  const affiliateLink = portal.affiliate
    ? `https://app.bookingpro.ai/auth?ref=${portal.affiliate.affiliate_code}`
    : '';

  if (!auth.isAuthed) {
    return (
      <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">BookingPro</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-1">Affiliate Portal</p>
          </div>
          {auth.authView === 'login' && (
            <LoginForm onSubmit={auth.handleLogin} onSwitchToSignup={() => auth.switchAuthView('signup')} onSwitchToForgot={() => auth.switchAuthView('forgot')} loading={auth.loading} error={auth.error} />
          )}
          {auth.authView === 'signup' && (
            <SignupForm onSubmit={auth.handleSignup} onSwitchToLogin={() => auth.switchAuthView('login')} loading={auth.loading} error={auth.error} />
          )}
          {auth.authView === 'forgot' && (
            <ForgotPasswordForm onSubmit={auth.handleForgotPassword} onSwitchToLogin={() => auth.switchAuthView('login')} loading={auth.loading} error={auth.error} />
          )}
          {auth.authView === 'reset' && (
            <ResetPasswordForm onSubmit={auth.handleResetPassword} onSwitchToLogin={() => auth.switchAuthView('login')} loading={auth.loading} error={auth.error} successMsg={auth.resetMsg} />
          )}
        </div>
      </div>
    );
  }

  // Plan N: Show pending/rejected screens
  if (portal.affiliate?.approval_status === 'pending_review') {
    return <PendingReviewScreen onLogout={handleLogout} />;
  }

  if (portal.affiliate?.approval_status === 'rejected') {
    return <RejectedScreen onLogout={handleLogout} />;
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-[hsl(var(--background))]">
        <Header affiliateName={portal.affiliate?.name ?? null} onLogout={handleLogout} />
        <TabNav />
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <DashboardTab
                  stats={portal.stats}
                  balance={portal.balance}
                  earningsHistory={portal.earningsHistory}
                  funnel={portal.funnel}
                  affiliateLink={affiliateLink}
                  dataLoading={portal.dataLoading}
                />
              }
            />
            <Route path="/referrals" element={<ReferralsTab referrals={portal.referrals} dataLoading={portal.dataLoading} />} />
            <Route path="/commissions" element={<CommissionsTab commissions={portal.commissions} dataLoading={portal.dataLoading} />} />
            <Route path="/payouts" element={<PayoutsTab />} />
            <Route path="/marketing" element={<MarketingTab affiliateLink={affiliateLink} />} />
            <Route
              path="/settings"
              element={
                <SettingsTab
                  affiliate={portal.affiliate}
                  onProfileUpdate={portal.loadData}
                />
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
