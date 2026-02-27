import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';

export default function ProtectedRoute() {
  const { isAuthenticated, loading, companyId } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  // Authenticated but no company — must complete onboarding
  if (!companyId) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
