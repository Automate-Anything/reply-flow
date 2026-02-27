import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Bot,
  ChevronsUpDown,
  Settings,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/contexts/SessionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base', permission: { resource: 'knowledge_base', action: 'view' } },
  { to: '/account', icon: Settings, label: 'Account', permission: { resource: 'company_settings', action: 'view' } },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { hasPermission } = useSession();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, loading: wsLoading } = useWorkspace();
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  const visibleNavItems = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission.resource, item.permission.action)
  );

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <aside
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <MessageSquareText className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold text-sidebar-foreground">
            Reply Flow
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

      {/* Workspace switcher */}
      {!collapsed && workspaces.length > 0 && (
        <div className="border-b border-sidebar-border p-2">
          <div className="relative">
            <button
              onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent"
            >
              <Bot className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
              <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
                {wsLoading ? 'Loading...' : activeWs?.name || 'Select workspace'}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
            </button>
            {wsDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWsDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => {
                        setActiveWorkspaceId(ws.id);
                        setWsDropdownOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                        ws.id === activeWorkspaceId && 'bg-accent font-medium'
                      )}
                    >
                      {ws.id === activeWorkspaceId ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{ws.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {ws.channel_count} ch
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 p-2">
        {visibleNavItems.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} delayDuration={collapsed ? 0 : 1000}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={onNavigate}
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
