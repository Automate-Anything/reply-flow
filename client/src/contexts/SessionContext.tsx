import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import api from '@/lib/api';

interface MeResponse {
  user: { id: string; email: string; full_name: string; avatar_url: string | null };
  company: { id: string; name: string; slug: string | null; logo_url: string | null } | null;
  role: { id: string; name: string; hierarchy_level: number } | null;
  permissions: string[];
}

interface SessionContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  userId: string | null;
  fullName: string;
  companyId: string | null;
  companyName: string | null;
  role: string | null;
  permissions: Set<string>;
  hasPermission: (resource: string, action: string) => boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const CACHE_KEY = 'reply-flow-session';
const LOADING_TIMEOUT = 10_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const hasLoadedOnceRef = useRef(false);

  const hasPermission = useCallback(
    (resource: string, action: string) => {
      if (role === 'owner') return true;
      return permissions.has(`${resource}.${action}`);
    },
    [role, permissions]
  );

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get<MeResponse>('/me');
      setCompanyId(data.company?.id ?? null);
      setCompanyName(data.company?.name ?? null);
      setRole(data.role?.name ?? null);
      setPermissions(new Set(data.permissions));
    } catch {
      // User may not have a company yet (invitation flow)
      setCompanyId(null);
      setCompanyName(null);
      setRole(null);
      setPermissions(new Set());
    }
  }, []);

  const updateSession = useCallback((newSession: Session | null) => {
    setSession(newSession);
    if (newSession) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(newSession));
    } else {
      localStorage.removeItem(CACHE_KEY);
      setCompanyId(null);
      setCompanyName(null);
      setRole(null);
      setPermissions(new Set());
    }
  }, []);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.auth.getSession();
    if (err) {
      setError(err.message);
      updateSession(null);
    } else {
      updateSession(data.session);
      if (data.session) await fetchMe();
    }
  }, [updateSession, fetchMe]);

  useEffect(() => {
    // Safety timeout if loading gets stuck
    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setError('Session loading timed out');
      }
    }, LOADING_TIMEOUT);

    // Get initial session
    supabase.auth.getSession().then(async ({ data, error: err }) => {
      if (err) {
        setError(err.message);
        updateSession(null);
      } else {
        updateSession(data.session);
        if (data.session) await fetchMe();
      }
      setLoading(false);
      hasLoadedOnceRef.current = true;
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        // Avoid unnecessary updates on tab focus after first load
        if (hasLoadedOnceRef.current) {
          updateSession(newSession);
          if (newSession) fetchMe();
          setLoading(false);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [loading, updateSession, fetchMe]);

  const user = session?.user ?? null;

  const value: SessionContextType = {
    user,
    session,
    isAuthenticated: !!session,
    userId: user?.id ?? null,
    fullName:
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      '',
    companyId,
    companyName,
    role,
    permissions,
    hasPermission,
    loading,
    error,
    refresh,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
