import { useState, useCallback, useRef } from 'react';
import {
  getAccessToken,
  logout as apiLogout,
  login as apiLogin,
  signup as apiSignup,
  forgotPassword as apiForgotPassword,
  resetPassword as apiResetPassword,
} from '../api';

type AuthView = 'login' | 'signup' | 'forgot' | 'reset';

// Extract reset token from URL at module load time (before any render)
// and immediately clear it from the URL to prevent leaking via Referer header.
const extractedResetToken = (() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return token;
})();

export function useAuth() {
  const [isAuthed, setIsAuthed] = useState(!!getAccessToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authView, setAuthView] = useState<AuthView>(() =>
    extractedResetToken ? 'reset' : 'login'
  );
  const [forgotMsg, setForgotMsg] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  const resetTokenRef = useRef<string | null>(extractedResetToken);

  const clearState = useCallback(() => {
    setError('');
    setForgotMsg('');
    setResetMsg('');
  }, []);

  const switchAuthView = useCallback((view: AuthView) => {
    setAuthView(view);
    setError('');
    setForgotMsg('');
    setResetMsg('');
    if (view !== 'reset') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setError('');
    setLoading(true);
    try {
      await apiLogin(email, password);
      setIsAuthed(true);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSignup = useCallback(async (name: string, email: string, password: string, phone?: string) => {
    setError('');
    setLoading(true);
    try {
      await apiSignup(name, email, password, phone);
      setIsAuthed(true);
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleForgotPassword = useCallback(async (email: string): Promise<string> => {
    setError('');
    setForgotMsg('');
    setLoading(true);
    try {
      const result = await apiForgotPassword(email);
      setForgotMsg(result.message);
      return result.message;
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
      return '';
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResetPassword = useCallback(async (password: string) => {
    setError('');
    setResetMsg('');
    setLoading(true);
    try {
      const token = resetTokenRef.current || '';
      await apiResetPassword(token, password);
      setResetMsg('Password reset! You can now sign in.');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    setIsAuthed(false);
  }, []);

  return {
    isAuthed,
    setIsAuthed,
    loading,
    error,
    authView,
    forgotMsg,
    resetMsg,
    switchAuthView,
    clearState,
    handleLogin,
    handleSignup,
    handleForgotPassword,
    handleResetPassword,
    handleLogout,
  };
}
