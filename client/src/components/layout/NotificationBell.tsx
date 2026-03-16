import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  UserPlus,
  Share2,
  MessageSquare,
  Clock,
  CalendarClock,
  Send,
  RefreshCw,
  StickyNote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications, type Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

const TYPE_ICONS: Record<string, typeof Bell> = {
  assignment: UserPlus,
  share: Share2,
  message_assigned: MessageSquare,
  message_accessible: MessageSquare,
  snooze_set: Clock,
  schedule_set: CalendarClock,
  schedule_sent: Send,
  status_change: RefreshCw,
  contact_note: StickyNote,
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function NotificationItem({
  notification,
  onClickNotification,
}: {
  notification: Notification;
  onClickNotification: (n: Notification) => void;
}) {
  const Icon = TYPE_ICONS[notification.type] || Bell;

  return (
    <button
      onClick={() => onClickNotification(notification)}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50',
        !notification.is_read && 'bg-accent/30'
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm', !notification.is_read && 'font-medium')}>
            {notification.title}
          </p>
          {!notification.is_read && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {timeAgo(notification.created_at)}
        </p>
      </div>
    </button>
  );
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleClickNotification = async (notification: Notification) => {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    setOpen(false);

    const conversationId = notification.data?.conversation_id as string | undefined;
    const contactId = notification.data?.contact_id as string | undefined;

    // Map notification type to target tab (only for tab-specific types)
    const tabByType: Record<string, string> = {
      snooze_set: 'snoozed',
      schedule_set: 'scheduled',
    };

    if (notification.type === 'contact_note') {
      navigate(contactId ? `/contacts?contact=${contactId}` : '/contacts');
    } else if (conversationId) {
      const tab = tabByType[notification.type];
      const params = new URLSearchParams();
      if (tab) params.set('tab', tab);
      params.set('conversation', conversationId);
      navigate(`/inbox?${params.toString()}`);
    } else {
      // Fallback: navigate to inbox without selecting a conversation
      navigate('/inbox');
    }
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClickNotification={handleClickNotification}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto w-full px-2 py-1.5 text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false);
              navigate('/profile-settings');
            }}
          >
            Notification preferences
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
