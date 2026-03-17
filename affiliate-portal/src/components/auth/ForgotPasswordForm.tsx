import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface ForgotPasswordFormProps {
  onSubmit: (email: string) => Promise<string>;
  onSwitchToLogin: () => void;
  loading: boolean;
  error: string;
}

function ForgotPasswordForm({ onSubmit, onSwitchToLogin, loading, error }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = await onSubmit(email);
    if (msg) setSuccessMsg(msg);
  };

  return (
    <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6 space-y-4">
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Forgot Password</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Enter your email and we'll send you a link to reset your password.
      </p>
      {successMsg ? (
        <div className="space-y-4">
          <p className="text-sm text-[hsl(var(--success))]">{successMsg}</p>
          <Button onClick={onSwitchToLogin} className="w-full">
            Back to Sign In
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-[hsl(var(--primary))] hover:opacity-80 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded"
            >
              Back to Sign In
            </button>
          </p>
        </form>
      )}
    </div>
  );
}

export { ForgotPasswordForm };
