import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        // Prefer redirect from URL (survives cross-device), fall back to sessionStorage
        const dest =
          searchParams.get('redirect') ||
          sessionStorage.getItem('auth_redirect') ||
          '/';
        sessionStorage.removeItem('auth_redirect');
        navigate(dest, { replace: true });
      } else {
        navigate('/auth', { replace: true });
      }
    });
  }, [navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
