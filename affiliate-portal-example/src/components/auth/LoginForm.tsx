import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  onSwitchToSignup: () => void;
  onSwitchToForgot: () => void;
  loading: boolean;
  error: string;
}

function LoginForm({ onSubmit, onSwitchToSignup, onSwitchToForgot, loading, error }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(email, password);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[hsl(var(--card))] rounded-lg shadow p-6 space-y-4">
      <Input
        label="Email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      <div>
        <Input
          label="Password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <div className="mt-1 text-right">
          <button
            type="button"
            onClick={onSwitchToForgot}
            className="text-xs text-[hsl(var(--primary))] hover:opacity-80 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded"
          >
            Forgot password?
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Signing in...' : 'Sign In'}
      </Button>
      <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
        Don't have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="text-[hsl(var(--primary))] hover:opacity-80 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded"
        >
          Sign Up
        </button>
      </p>
    </form>
  );
}

export { LoginForm };
