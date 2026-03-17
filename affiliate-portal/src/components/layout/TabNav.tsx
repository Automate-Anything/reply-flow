import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Receipt,
  Wallet,
  Megaphone,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface TabDef {
  key: string;
  label: string;
  icon: ReactNode;
}

const tabs: TabDef[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'referrals', label: 'Referrals', icon: <Users className="h-4 w-4" /> },
  { key: 'commissions', label: 'Commissions', icon: <Receipt className="h-4 w-4" /> },
  { key: 'payouts', label: 'Payouts', icon: <Wallet className="h-4 w-4" /> },
  { key: 'marketing', label: 'Marketing', icon: <Megaphone className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

function TabNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.replace(/^\//, '') || 'dashboard';

  return (
    <div className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
      <div className="max-w-6xl mx-auto px-4">
        <nav className="flex gap-1" role="tablist" aria-label="Portal navigation">
          {tabs.map((t) => {
            const isActive = currentPath === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => navigate(`/${t.key}`)}
                className={`inline-flex items-center gap-2 py-3 px-3 text-sm font-medium border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-inset rounded-t ${
                  isActive
                    ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                    : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export { TabNav, tabs };
