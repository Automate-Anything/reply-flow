import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface ResetPasswordFormProps {
  onSubmit: (password: string) => Promise<void>;
  onSwitchToLogin: () => void;
  loading: boolean;
  error: string;
  successMsg: string;
}

function ResetPasswordForm({ onSubmit, onSwitchToLogin, loading, error, successMsg }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    if (password !== confirmPw) {
      setValidationError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setValidationError('Password must include at least 1 uppercase letter, 1 lowercase letter, and 1 number');
      return;
    }
    await onSubmit(password);
  };

  const displayError = validationError || error;

  return (
    <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6 space-y-4">
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Reset Password</h2>
      {successMsg ? (
        <div className="space-y-4">
          <p className="text-sm text-[hsl(var(--success))]">{successMsg}</p>
          <Button onClick={onSwitchToLogin} className="w-full">
            Sign In
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              label="New Password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Min 8 characters, 1 uppercase, 1 lowercase, 1 number
            </p>
          </div>
          <Input
            label="Confirm Password"
            type="password"
            required
            minLength={8}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="••••••••"
          />
          {displayError && <p className="text-sm text-[hsl(var(--destructive))]">{displayError}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Resetting...' : 'Reset Password'}
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

export { ResetPasswordForm };
