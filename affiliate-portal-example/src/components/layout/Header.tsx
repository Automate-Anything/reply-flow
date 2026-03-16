import { LogOut } from 'lucide-react';

interface HeaderProps {
  affiliateName: string | null;
  onLogout: () => void;
}

function Header({ affiliateName, onLogout }: HeaderProps) {
  return (
    <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[hsl(var(--foreground))]">BookingPro</h1>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Affiliate Portal</p>
        </div>
        <div className="flex items-center gap-4">
          {affiliateName && (
            <span className="text-sm text-[hsl(var(--muted-foreground))] hidden sm:block">
              {affiliateName}
            </span>
          )}
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded px-2 py-1"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

export { Header };
