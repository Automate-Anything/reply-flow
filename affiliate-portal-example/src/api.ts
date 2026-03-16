const API_URL = (() => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  );
  if (isLocalhost) {
    return 'http://localhost:3001';
  }
  throw new Error('VITE_API_URL environment variable is required in production. Set it in your deployment configuration.');
})();

const REFRESH_TOKEN_KEY = 'bp_affiliate_refresh_token';

// H10: Store access token in memory only — not in localStorage.
// Clean up any access token previously stored in localStorage by older code.
localStorage.removeItem('bp_affiliate_access_token');
let accessToken: string | null = null;

// H12: Promise-based refresh queue — concurrent 401s share a single refresh call
let refreshPromise: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setTokens(newAccessToken: string, refreshToken: string) {
  accessToken = newAccessToken;
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

function clearTokens() {
  accessToken = null;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/affiliate/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

// H12: Deduplicates concurrent refresh attempts into a single request
async function ensureTokenRefreshed(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshTokens().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function request<T = any>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, any>
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/affiliate${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    // On 401, attempt a token refresh and retry once
    if (res.status === 401) {
      const refreshed = await ensureTokenRefreshed();
      if (refreshed) {
        // Retry the original request with the new access token
        const newToken = getAccessToken();
        const retryRes = await fetch(`${API_URL}/affiliate${endpoint}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
          },
          ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
        });

        if (retryRes.ok) {
          const text = await retryRes.text();
          return text ? JSON.parse(text) : ({} as T);
        }

        // Retry also failed — clear tokens
        clearTokens();
        const data = await retryRes.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || `HTTP ${retryRes.status}`);
      } else {
        clearTokens();
        throw new Error('Session expired. Please sign in again.');
      }
    }

    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    if (res.status === 401) clearTokens();
    if (res.status === 429) throw new Error(data.error || 'Too many attempts. Please try again later.');
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

// Auth
export async function login(email: string, password: string) {
  const result = await request<{
    accessToken: string;
    refreshToken: string;
    affiliate: { id: string; name: string; email: string; affiliate_code: string };
  }>('/login', 'POST', { email, password });
  setTokens(result.accessToken, result.refreshToken);
  return result;
}

export async function signup(name: string, email: string, password: string, phone?: string) {
  const result = await request<{
    accessToken: string;
    refreshToken: string;
    affiliate: { id: string; name: string; email: string; affiliate_code: string };
  }>('/signup', 'POST', { name, email, password, phone });
  setTokens(result.accessToken, result.refreshToken);
  return result;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  try {
    await fetch(`${API_URL}/affiliate/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Best-effort — clear tokens regardless
  }
  clearTokens();
}

// Password Reset
export const forgotPassword = (email: string) =>
  request<{ message: string }>('/forgot-password', 'POST', { email });

export const resetPassword = (token: string, newPassword: string) =>
  request<{ success: boolean }>('/reset-password', 'POST', { token, newPassword });

// Data
export const getProfile = () => request<{ affiliate: any }>('/me');
export const getReferrals = () => request<{ referrals: any[] }>('/referrals');
export const getCommissions = () => request<{ events: any[] }>('/commissions');
export const getStats = () =>
  request<{
    totalReferrals: number;
    activeCompanies: number;
    totalCommission: number;
    thisMonthCommission: number;
  }>('/stats');
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ success: boolean }>('/password', 'PUT', { currentPassword, newPassword });

// Plan J: Self-Service
export const updateProfile = (data: { name?: string; email?: string; phone?: string }) =>
  request<{ affiliate: any }>('/profile', 'PUT', data);
export const getAgreement = () =>
  request<{ version: string; termsText: string; accepted: boolean; acceptedAt: string | null }>('/agreement');
export const acceptAgreement = (version: string) =>
  request<{ success: boolean }>('/agreement/accept', 'POST', { version });
export const requestAccountDeletion = (reason?: string) =>
  request<{ success: boolean; message: string }>('/delete-request', 'POST', { reason });

// Plan K: Dashboard & Analytics
export const getBalance = () =>
  request<{ totalEarnedCents: number; totalPaidOutCents: number; pendingPayoutCents: number; balanceOwedCents: number }>('/balance');
export const getEarningsHistory = () =>
  request<{ history: Array<{ month: string; amountCents: number }> }>('/earnings-history');
export const getPayoutHistory = () =>
  request<{ payouts: Array<{ id: string; period_start: string; period_end: string; amount_cents: number; status: string; payment_method: string | null; paid_at: string | null; created_at: string }> }>('/payout-history');
export const getFunnel = () =>
  request<{ clicks: number; signups: number; trials: number; active: number; churned: number; clickToSignupRate: number; signupToActiveRate: number }>('/funnel');

// Plan L: Notification Preferences
export const getNotificationPreferences = () =>
  request<{ preferences: Record<string, boolean> }>('/notification-preferences');
export const updateNotificationPreferences = (preferences: Record<string, boolean>) =>
  request<{ preferences: Record<string, boolean> }>('/notification-preferences', 'PUT', { preferences });

// Plan M: Marketing Tools
export const getCampaigns = () =>
  request<{ campaigns: Array<{ id: string; name: string; slug: string; description: string | null; total_clicks: number; total_signups: number; created_at: string; url: string; directUrl: string }> }>('/campaigns');
export const createCampaign = (name: string, description?: string) =>
  request<{ campaign: any }>('/campaigns', 'POST', { name, description });
export const deleteCampaign = (id: string) =>
  request<{ success: boolean }>(`/campaigns/${id}`, 'DELETE');
