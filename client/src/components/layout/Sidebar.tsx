import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Settings,
  Smartphone,
  Bot,
  UsersRound,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useCallback, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/contexts/SessionContext';
import { useFormGuard } from '@/contexts/FormGuardContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base', permission: { resource: 'knowledge_base', action: 'view' } },
  { to: '/ai-agents', icon: Bot, label: 'AI Agents', permission: { resource: 'ai_settings', action: 'view' } },
  { to: '/channels', icon: Smartphone, label: 'Channels' },
  { to: '/channel-health', icon: ShieldCheck, label: 'Channel Health' },
  { to: '/whatsapp-groups', icon: UsersRound, label: 'WhatsApp Groups' },
  { to: '/company-settings', icon: Settings, label: 'Company Settings', permission: { resource: 'company_settings', action: 'view' } },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { hasPermission, companyLogoUrl, companyName } = useSession();
  const { guardNavigation } = useFormGuard();
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavClick = useCallback((e: MouseEvent, to: string) => {
    e.preventDefault();
    // Already on this page — no guard needed
    if (location.pathname === to || (to === '/' && location.pathname === '/')) {
      onNavigate?.();
      return;
    }
    const blocked = guardNavigation(() => {
      navigate(to);
      onNavigate?.();
    });
    if (!blocked) return; // already navigated
  }, [guardNavigation, navigate, location.pathname, onNavigate]);

  const visibleNavItems = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission.resource, item.permission.action)
  );

  return (
    <aside
      data-component="Sidebar"
      className={cn(
        'flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200',
        collapsed ? 'w-[60px]' : 'w-[240px]'
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-2'
        )}
      >
        {companyLogoUrl ? (
          <img
            src={companyLogoUrl}
            alt={companyName || 'Company logo'}
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <MessageSquareText className="h-4 w-4 text-primary-foreground" />
          </div>
        )}
        {!collapsed && (
          <span className="truncate text-lg font-semibold text-sidebar-foreground">
            {companyName || 'Reply Flow'}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'ml-auto h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent',
            collapsed && 'ml-0'
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </Button>
      </div>

      <nav className="flex flex-1 flex-col space-y-1 p-2">
        {visibleNavItems.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} delayDuration={collapsed ? 0 : 1000}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={(e) => handleNavClick(e, to)}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    isActive &&
                      'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:bottom-1 before:left-0 before:top-1 before:w-[3px] before:rounded-full before:bg-primary',
                    collapsed && 'justify-center px-2'
                  )
                }
              >
                <Icon size={20} />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">{label}</TooltipContent>
            )}
          </Tooltip>
        ))}

      </nav>
    </aside>
  );
}
