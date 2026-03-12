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
  profile: { id: string; email: string; full_name: string; avatar_url: string | null };
  company: { id: string; name: string; slug: string | null; logo_url: string | null; timezone: string | null } | null;
  role: { id: string; name: string; hierarchy_level: number } | null;
  permissions: string[];
  is_super_admin?: boolean;
}

interface SessionContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  userId: string | null;
  fullName: string;
  avatarUrl: string | null;
  companyId: string | null;
  companyName: string | null;
  companyTimezone: string;
  role: string | null;
  permissions: Set<string>;
  hasPermission: (resource: string, action: string) => boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const CACHE_KEY = 'reply-flow-session';
const ME_CACHE_KEY = 'reply-flow-me';
const LOADING_TIMEOUT = 10_000;

function getCachedMe(): MeResponse | null {
  try {
    const cached = localStorage.getItem(ME_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const cachedSession = (() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? JSON.parse(cached) as Session : null;
    } catch {
      return null;
    }
  })();
  const cachedMe = getCachedMe();
  const hasCachedData = !!(cachedSession && cachedMe);

  const [session, setSession] = useState<Session | null>(cachedSession);
  const [loading, setLoading] = useState(!hasCachedData);
  const [error, setError] = useState<string | null>(null);
  const [profileFullName, setProfileFullName] = useState<string | null>(cachedMe?.profile?.full_name ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cachedMe?.profile?.avatar_url ?? null);
  const [companyId, setCompanyId] = useState<string | null>(cachedMe?.company?.id ?? null);
  const [companyName, setCompanyName] = useState<string | null>(cachedMe?.company?.name ?? null);
  const [companyTimezone, setCompanyTimezone] = useState(cachedMe?.company?.timezone || 'UTC');
  const [role, setRole] = useState<string | null>(cachedMe?.role?.name ?? null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set(cachedMe?.permissions));
  const [isSuperAdmin, setIsSuperAdmin] = useState(cachedMe?.is_super_admin || false);
  const hasLoadedOnceRef = useRef(hasCachedData);
  const sessionRef = useRef(session);

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
      setError(null);
      setProfileFullName(data.profile?.full_name ?? null);
      setAvatarUrl(data.profile?.avatar_url ?? null);
      setCompanyId(data.company?.id ?? null);
      setCompanyName(data.company?.name ?? null);
      setCompanyTimezone(data.company?.timezone || 'UTC');
      setRole(data.role?.name ?? null);
      setPermissions(new Set(data.permissions));
      setIsSuperAdmin(data.is_super_admin || false);
      localStorage.setItem(ME_CACHE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[SessionContext] fetchMe failed:', err);
      setError('Failed to refresh profile data');
    }
  }, []);

  const updateSession = useCallback((newSession: Session | null) => {
    setSession(newSession);
    sessionRef.current = newSession;
    if (newSession) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(newSession));
    } else {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(ME_CACHE_KEY);
      localStorage.removeItem('reply-flow-plan');
      localStorage.removeItem('reply-flow-conversations');
      localStorage.removeItem('reply-flow-dashboard');
      localStorage.removeItem('reply-flow-agents');
      localStorage.removeItem('reply-flow-contacts');
      localStorage.removeItem('reply-flow-kbs');
      localStorage.removeItem('reply-flow-channels');
      sessionStorage.removeItem('reply-flow-active-conversation');
      sessionStorage.removeItem('reply-flow-scroll-positions');
      setProfileFullName(null);
      setAvatarUrl(null);
      setCompanyId(null);
      setCompanyName(null);
      setCompanyTimezone('UTC');
      setRole(null);
      setPermissions(new Set());
      setIsSuperAdmin(false);
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
    let isMounted = true;

    // Safety timeout if loading gets stuck
    const timeout = setTimeout(() => {
      if (isMounted && !hasLoadedOnceRef.current) {
        setLoading(false);
        setError('Session loading timed out');
      }
    }, LOADING_TIMEOUT);

    // Get initial session
    supabase.auth.getSession().then(async ({ data, error: err }) => {
      if (!isMounted) return;

      if (err) {
        setError(err.message);
        updateSession(null);
      } else {
        updateSession(data.session);
        if (data.session) await fetchMe();
      }
      if (isMounted) {
        setLoading(false);
        hasLoadedOnceRef.current = true;
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!hasLoadedOnceRef.current) return;

        // Token refresh / re-sign-in on tab focus — just update the token silently
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          updateSession(newSession);
          return;
        }

        // For SIGNED_IN, check if user actually changed (tab focus also fires SIGNED_IN)
        const prevUserId = sessionRef.current?.user?.id;
        const newUserId = newSession?.user?.id;
        if (event === 'SIGNED_IN' && prevUserId && prevUserId === newUserId) {
          updateSession(newSession);
          return;
        }

        // Real auth changes (new sign-in, sign-out, password recovery, etc.)
        if (newSession) setLoading(true);
        updateSession(newSession);
        if (newSession) await fetchMe();
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [updateSession, fetchMe]);

  const user = session?.user ?? null;

  const value: SessionContextType = {
    user,
    session,
    isAuthenticated: !!session,
    userId: user?.id ?? null,
    fullName:
      profileFullName ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      '',
    avatarUrl,
    companyId,
    companyName,
    companyTimezone,
    role,
    permissions,
    hasPermission,
    isSuperAdmin,
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
