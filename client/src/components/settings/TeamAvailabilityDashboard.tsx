import { useState, useEffect, useMemo } from 'react';
import api from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Circle, Clock, Users } from 'lucide-react';

interface PersonalHours {
  [day: string]: { start: string; end: string } | null;
}

interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  timezone: string;
  personal_hours: PersonalHours | null;
  hours_controlled: boolean;
  is_available: boolean;
}

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

function summarizeHours(hours: PersonalHours | null): string {
  if (!hours) return 'No schedule set';

  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayAbbr: Record<string, string> = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
    friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
  };

  const activeDays: { day: string; start: string; end: string }[] = [];
  for (const day of dayOrder) {
    const slot = hours[day];
    if (slot && slot.start && slot.end) {
      activeDays.push({ day, start: slot.start, end: slot.end });
    }
  }

  if (activeDays.length === 0) return 'No schedule set';

  // Check if all active days share the same hours
  const allSameHours = activeDays.every(
    (d) => d.start === activeDays[0].start && d.end === activeDays[0].end
  );

  if (allSameHours) {
    // Group consecutive days
    const dayNames = activeDays.map((d) => dayAbbr[d.day]);
    const range = dayNames.length === 1
      ? dayNames[0]
      : `${dayNames[0]}-${dayNames[dayNames.length - 1]}`;
    return `${range} ${activeDays[0].start}-${activeDays[0].end}`;
  }

  return `${activeDays.length} days configured`;
}

export default function TeamAvailabilityDashboard() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [companyTimezone, setCompanyTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      try {
        const { data } = await api.get('/team/availability');
        if (!cancelled) {
          setMembers(data.members || []);
          setCompanyTimezone(data.company_timezone || 'UTC');
        }
      } catch {
        // silently fail — dashboard is informational
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetch();
    return () => { cancelled = true; };
  }, []);

  const sorted = useMemo(() => {
    return [...members].sort((a, b) => {
      // Available first
      if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
      // Then alphabetical by name
      const nameA = (a.full_name || a.email || '').toLowerCase();
      const nameB = (b.full_name || b.email || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [members]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Team Availability
        </CardTitle>
        <CardDescription>
          See who's available and their working hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No team members found.
          </p>
        ) : (
          <div className="space-y-1">
            {sorted.map((member) => {
              const showTimezone = member.timezone !== companyTimezone;
              return (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                >
                  <Avatar size="default">
                    {member.avatar_url && (
                      <AvatarImage src={member.avatar_url} alt={member.full_name || ''} />
                    )}
                    <AvatarFallback>
                      {getInitials(member.full_name, member.email)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {member.full_name || member.email || 'Unknown'}
                      </span>
                      {member.role && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {member.role}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{summarizeHours(member.personal_hours as PersonalHours | null)}</span>
                      {member.hours_controlled && (
                        <Clock className="h-3 w-3 shrink-0" />
                      )}
                      {showTimezone && (
                        <span className="text-muted-foreground/70">{member.timezone}</span>
                      )}
                    </div>
                  </div>

                  <Circle
                    className={`h-3 w-3 shrink-0 ${
                      member.is_available
                        ? 'fill-green-500 text-green-500'
                        : 'fill-muted-foreground/40 text-muted-foreground/40'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
