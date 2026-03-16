import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface SignupFormProps {
  onSubmit: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  onSwitchToLogin: () => void;
  loading: boolean;
  error: string;
}

function SignupForm({ onSubmit, onSwitchToLogin, loading, error }: SignupFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(name, email, password, phone || undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[hsl(var(--card))] rounded-lg shadow p-6 space-y-4">
      <Input
        label="Full Name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="John Doe"
      />
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
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Minimum 8 characters</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
          Phone <span className="text-[hsl(var(--muted-foreground))] font-normal">(optional)</span>
        </label>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 (555) 000-0000"
        />
      </div>
      {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Creating account...' : 'Create Account'}
      </Button>
      <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-[hsl(var(--primary))] hover:opacity-80 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded"
        >
          Sign In
        </button>
      </p>
    </form>
  );
}

export { SignupForm };
