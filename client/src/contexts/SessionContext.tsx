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

interface SessionContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  userId: string | null;
  fullName: string;
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
  const hasLoadedOnceRef = useRef(false);

  const updateSession = useCallback((newSession: Session | null) => {
    setSession(newSession);
    if (newSession) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(newSession));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.auth.getSession();
    if (err) {
      setError(err.message);
      updateSession(null);
    } else {
      updateSession(data.session);
    }
  }, [updateSession]);

  useEffect(() => {
    // Safety timeout if loading gets stuck
    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setError('Session loading timed out');
      }
    }, LOADING_TIMEOUT);

    // Get initial session
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (err) {
        setError(err.message);
        updateSession(null);
      } else {
        updateSession(data.session);
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
          setLoading(false);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [loading, updateSession]);

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
