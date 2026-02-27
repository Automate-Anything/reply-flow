import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Loader2, MessageSquareText, Building2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface InviteContext {
  company_name: string;
  role_name: string;
  email: string;
}

type AuthTab = 'signin' | 'signup' | 'forgot';

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const isRecovery = searchParams.get('type') === 'recovery';
  const redirectTo = searchParams.get('redirect');

  // Extract invite token from redirect path like /invite/abc123
  const inviteToken = redirectTo?.match(/^\/invite\/(.+)$/)?.[1] || null;
  const [inviteCtx, setInviteCtx] = useState<InviteContext | null>(null);

  // Fetch invite preview (public endpoint, no auth needed)
  useEffect(() => {
    if (!inviteToken) return;
    axios
      .get(`${API_URL}/api/team/invite-preview/${inviteToken}`)
      .then(({ data }) => setInviteCtx(data.invitation))
      .catch(() => {}); // Silently ignore — context is optional
  }, [inviteToken]);

  // Persist redirect so it survives OAuth round-trip
  useEffect(() => {
    if (redirectTo) sessionStorage.setItem('auth_redirect', redirectTo);
  }, [redirectTo]);

  // Once authenticated, navigate to the saved redirect (or home)
  useEffect(() => {
    if (!isAuthenticated) return;
    const dest = sessionStorage.getItem('auth_redirect') || '/';
    sessionStorage.removeItem('auth_redirect');
    navigate(dest, { replace: true });
  }, [isAuthenticated, navigate]);

  const [tab, setTab] = useState<AuthTab>('signin');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Sign In
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);

  // Sign Up
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  // Forgot / Reset
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  useEffect(() => {
    if (isRecovery) setTab('forgot');
  }, [isRecovery]);

  const clearMessages = () => {
    setMessage('');
    setError('');
  };

  const validatePassword = (pw: string): string | null => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
    if (!/\d/.test(pw)) return 'Password must contain a number';
    return null;
  };

  // Build callback URL with redirect param baked in so it survives cross-device / new-tab
  const callbackUrl = redirectTo
    ? `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`
    : `${window.location.origin}/auth/callback`;

  const handleGoogleOAuth = async () => {
    clearMessages();
    setOauthLoading(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl },
    });
    if (err) {
      setError(err.message);
      setOauthLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: signInPassword,
    });
    if (err) setError(err.message);
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const pwError = validatePassword(signUpPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (signUpPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.signUp({
      email: signUpEmail,
      password: signUpPassword,
      options: {
        data: { full_name: `${firstName} ${lastName}`.trim() },
        emailRedirectTo: callbackUrl,
      },
    });
    if (err) {
      setError(err.message);
    }
    // With email confirmation disabled, signup auto-logs in.
    // The isAuthenticated effect will handle redirect.
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      forgotEmail,
      { redirectTo: `${window.location.origin}/auth?type=recovery` }
    );
    if (err) {
      setError(err.message);
    } else {
      setMessage('Check your email for a password reset link.');
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    const pwError = validatePassword(newPassword);
    if (pwError) {
      setError(pwError);
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (err) {
      setError(err.message);
    } else {
      setMessage('Password updated successfully. You can now sign in.');
    }
    setLoading(false);
  };

  const PasswordToggle = ({
    show,
    onToggle,
  }: {
    show: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
    >
      {show ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <MessageSquareText className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-semibold">Reply Flow</CardTitle>
          <p className="text-sm text-muted-foreground">
            WhatsApp business inbox powered by AI
          </p>
        </CardHeader>
        <CardContent>
          {inviteCtx && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  You've been invited to join{' '}
                  <span className="font-semibold">{inviteCtx.company_name}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Sign in or create an account to continue as{' '}
                  <Badge variant="outline" className="text-[11px] px-1.5 py-0 align-middle">
                    {inviteCtx.role_name}
                  </Badge>
                </p>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {message && (
            <div className="mb-4 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
              {message}
            </div>
          )}

          {isRecovery ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <h3 className="text-lg font-medium">Set New Password</h3>
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    required
                  />
                  <PasswordToggle
                    show={showNewPassword}
                    onToggle={() => setShowNewPassword(!showNewPassword)}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as AuthTab);
                clearMessages();
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 pt-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleOAuth}
                  disabled={oauthLoading}
                  type="button"
                >
                  {oauthLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                  )}
                  {oauthLoading ? 'Redirecting...' : 'Continue with Google'}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or continue with email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <div className="relative">
                      <Input
                        type={showSignInPassword ? 'text' : 'password'}
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        placeholder="Password"
                        required
                      />
                      <PasswordToggle
                        show={showSignInPassword}
                        onToggle={() =>
                          setShowSignInPassword(!showSignInPassword)
                        }
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign In'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('forgot');
                      clearMessages();
                    }}
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 pt-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleOAuth}
                  disabled={oauthLoading}
                  type="button"
                >
                  {oauthLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                  )}
                  {oauthLoading ? 'Redirecting...' : 'Continue with Google'}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or continue with email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>First Name</Label>
                      <Input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="John"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Last Name</Label>
                      <Input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <div className="relative">
                      <Input
                        type={showSignUpPassword ? 'text' : 'password'}
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        placeholder="Min 8 chars, upper, lower, number"
                        required
                      />
                      <PasswordToggle
                        show={showSignUpPassword}
                        onToggle={() =>
                          setShowSignUpPassword(!showSignUpPassword)
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Confirm Password</Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Creating account...' : 'Create Account'}
                  </Button>
                </form>
              </TabsContent>

              {tab === 'forgot' && (
                <div className="space-y-4 pt-4">
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('signin');
                        clearMessages();
                      }}
                      className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      Back to Sign In
                    </button>
                  </form>
                </div>
              )}
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
