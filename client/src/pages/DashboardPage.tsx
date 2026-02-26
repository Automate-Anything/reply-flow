import { useNavigate } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';
import { useDashboardData } from '@/hooks/useDashboardData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  MessageSquare,
  Users,
  Wifi,
  WifiOff,
  Bot,
  ArrowRight,
  MessageCircle,
  UserPlus,
  Settings,
} from 'lucide-react';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DashboardPage() {
  const { fullName } = useSession();
  const { data, loading } = useDashboardData();
  const navigate = useNavigate();
  const firstName = fullName.split(' ')[0] || 'there';

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here's what's happening with your WhatsApp inbox today.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/inbox')}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.unreadCount}</p>
              <p className="text-xs text-muted-foreground">Unread Messages</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-chart-2/10">
              <MessageCircle className="h-5 w-5 text-chart-2" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.totalConversations}</p>
              <p className="text-xs text-muted-foreground">Conversations</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/contacts')}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-chart-4/10">
              <Users className="h-5 w-5 text-chart-4" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data.totalContacts}</p>
              <p className="text-xs text-muted-foreground">Contacts</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/channels')}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                data.connectedChannelCount > 0
                  ? 'bg-primary/10'
                  : 'bg-destructive/10'
              }`}
            >
              {data.connectedChannelCount > 0 ? (
                <Wifi className="h-5 w-5 text-primary" />
              ) : (
                <WifiOff className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">
                {data.totalChannelCount === 0
                  ? 'No Channels'
                  : `${data.connectedChannelCount} / ${data.totalChannelCount} Connected`}
              </p>
              <p className="text-xs text-muted-foreground">WhatsApp Channels</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Conversations */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Conversations
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/inbox')}
              className="gap-1 text-xs text-muted-foreground"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {data.recentConversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <MessageSquare className="h-5 w-5 opacity-40" />
                </div>
                <p>No conversations yet</p>
              </div>
            ) : (
              data.recentConversations.map((conv) => {
                const name = conv.contact_name || conv.phone_number;
                const initial = (name[0] || '?').toUpperCase();
                return (
                  <button
                    key={conv.id}
                    onClick={() => navigate('/inbox')}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatRelativeTime(conv.last_message_at)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {conv.last_message || 'No messages yet'}
                      </p>
                    </div>
                    {conv.unread_count > 0 && (
                      <Badge className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* AI Agent Status */}
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">AI Agent</p>
                <p className="text-xs text-muted-foreground">
                  Configure per channel
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/channels')}
                className="text-xs"
              >
                Configure
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => navigate('/inbox')}
              >
                <MessageSquare className="h-4 w-4" /> Go to Inbox
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => navigate('/contacts')}
              >
                <UserPlus className="h-4 w-4" /> Manage Contacts
              </Button>
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => navigate('/channels')}
              >
                <Settings className="h-4 w-4" /> Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
