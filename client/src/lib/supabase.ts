import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Capture OAuth tokens from URL hash before Supabase can clear them
const hashParams = new URLSearchParams(
  window.location.hash.substring(1)
);
const accessTokenFromHash = hashParams.get('access_token');
const refreshTokenFromHash = hashParams.get('refresh_token');

// Safe lock implementation to avoid Chrome deadlock bug with navigator.locks
const safeLock = async <R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> => {
  return await navigator.locks.request(
    name,
    { ifAvailable: true },
    async (lock): Promise<R> => {
      if (lock) {
        return await fn();
      }
      // Could not acquire lock immediately, wait with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), acquireTimeout);
      try {
        return await navigator.locks.request(
          name,
          { signal: controller.signal },
          async (): Promise<R> => {
            return await fn();
          }
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: (name, acquireTimeout, fn) => safeLock(name, acquireTimeout, fn),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Set session from captured hash tokens as fallback
if (accessTokenFromHash && refreshTokenFromHash) {
  supabase.auth.setSession({
    access_token: accessTokenFromHash,
    refresh_token: refreshTokenFromHash,
  });
}
