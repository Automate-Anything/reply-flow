import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, Moon, Sun, LogOut, Loader2, User, Building2, Shield, Circle, Clock } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { fullName, avatarUrl, companyName, hasPermission, isSuperAdmin } = useSession();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const canViewCompanySettings = hasPermission('company_settings', 'view');

  const [isAvailable, setIsAvailable] = useState(true);
  const [hoursControlled, setHoursControlled] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [availRes, meRes] = await Promise.all([
          api.get('/auto-assign/my-availability'),
          api.get('/me'),
        ]);
        setIsAvailable(availRes.data.is_available);
        setHoursControlled(meRes.data.profile.hours_control_availability ?? false);
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleToggleAvailability = useCallback(async (checked: boolean) => {
    setIsAvailable(checked);
    try {
      await api.patch('/auto-assign/my-availability', { is_available: checked });
    } catch {
      setIsAvailable(!checked);
    }
  }, []);

  const pageTitle = (() => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    if (path === '/inbox') return 'Inbox';
    if (path === '/contacts') return 'Contacts';
    if (path === '/knowledge-base') return 'Knowledge Base';
    if (path === '/channels') return 'Channels';
    if (path.startsWith('/ai-agents')) return 'AI Agents';
    if (path === '/schedule') return 'Schedule';
    if (path === '/company-settings') return 'Company Settings';
    if (path === '/profile-settings') return 'Profile Settings';
    return '';
  })();

  const initials = fullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
        {pageTitle && (
          <h1 className="text-base font-semibold md:text-lg">{pageTitle}</h1>
        )}
        {companyName && (
          <span className="hidden text-sm text-muted-foreground md:block">{companyName}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium',
                isAvailable
                  ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50'
                  : 'border-muted text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => handleToggleAvailability(!isAvailable)}
            >
              <Circle
                className={cn(
                  'h-2 w-2 fill-current',
                  isAvailable ? 'text-green-500' : 'text-muted-foreground/40'
                )}
              />
              {isAvailable ? 'Available' : 'Away'}
              {hoursControlled && <Clock className="h-3 w-3 ml-0.5 text-muted-foreground" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {hoursControlled
              ? isAvailable
                ? 'Your availability is managed by your working hours. Click to override until tomorrow.'
                : 'You\u2019re outside your working hours. Click to override until tomorrow.'
              : isAvailable
                ? 'You can receive new conversations. Click to go away.'
                : 'You won\u2019t be assigned new conversations. Click to go available.'}
          </TooltipContent>
        </Tooltip>
        <NotificationBell />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-9 w-9"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="h-7 w-7 ring-2 ring-primary/20">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
                <AvatarFallback className="text-xs">
                  {initials || <User size={14} />}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline-block">
                {fullName}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate('/profile-settings')}>
              <User className="mr-2 h-4 w-4" />
              Profile Settings
            </DropdownMenuItem>
            {canViewCompanySettings && (
              <DropdownMenuItem onClick={() => navigate('/company-settings')}>
                <Building2 className="mr-2 h-4 w-4" />
                Company Settings
              </DropdownMenuItem>
            )}
            {isSuperAdmin && (
              <DropdownMenuItem onClick={() => navigate('/super-admin')}>
                <Shield className="mr-2 h-4 w-4" />
                Super Admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              {signingOut ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
