import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Building2, Trash2, Clock, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import BusinessHoursSettings from '@/components/settings/BusinessHoursSettings';
import HolidayEditor from '@/components/settings/HolidayEditor';
import TeamAvailabilityDashboard from '@/components/settings/TeamAvailabilityDashboard';
import { PlanGate } from '@/components/auth/PlanGate';

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  timezone: string;
  session_timeout_hours: number;
  business_type: string | null;
  business_description: string | null;
}

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    return [
      'UTC',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai',
      'Asia/Tokyo', 'Asia/Jerusalem', 'Australia/Sydney', 'Pacific/Auckland',
    ];
  }
})();

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const { hasPermission, role, companyName, refresh } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');
  const isOwner = role === 'owner';

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [sessionTimeout, setSessionTimeout] = useState(24);
  const [savingTimeout, setSavingTimeout] = useState(false);

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      setCompany(data.company);
      setName(data.company.name);
      setBusinessType(data.company.business_type || '');
      setBusinessDescription(data.company.business_description || '');
      setTimezone(data.company.timezone || 'UTC');
      setSessionTimeout(data.company.session_timeout_hours ?? 24);
    } catch {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return TIMEZONES;
    const q = tzSearch.toLowerCase();
    return TIMEZONES.filter((tz) => tz.toLowerCase().includes(q));
  }, [tzSearch]);

  const hasChanges = useMemo(() => {
    if (!company) return false;
    return (
      name.trim() !== company.name ||
      businessType.trim() !== (company.business_type || '') ||
      businessDescription.trim() !== (company.business_description || '') ||
      timezone !== (company.timezone || 'UTC')
    );
  }, [company, name, businessType, businessDescription, timezone]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/company', {
        name: name.trim(),
        business_type: businessType.trim() || null,
        business_description: businessDescription.trim() || null,
        timezone,
      });
      setCompany(data.company);
      toast.success('Company settings updated');
    } catch {
      toast.error('Failed to update company settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete('/company');
      await refresh();
      navigate('/onboarding', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to delete company';
      toast.error(msg);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Company Information
          </CardTitle>
          <CardDescription>General settings for your company.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Company Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              placeholder="Your company name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="business-type">Business Type</Label>
            <Input
              id="business-type"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. Restaurant, E-commerce, Consulting"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="business-description">About</Label>
            <textarea
              id="business-description"
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value)}
              disabled={!canEdit}
              rows={3}
              placeholder="Briefly describe what your company does..."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <p className="text-xs text-muted-foreground">
              Used for business hours and scheduling across the platform.
            </p>
            <Popover open={tzOpen} onOpenChange={(open) => { setTzOpen(open); if (!open) setTzSearch(''); }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={tzOpen}
                  disabled={!canEdit}
                  className="w-full justify-between font-normal"
                >
                  {timezone}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="border-b px-3 py-2">
                  <Input
                    placeholder="Search timezones..."
                    value={tzSearch}
                    onChange={(e) => setTzSearch(e.target.value)}
                    className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {filteredTimezones.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">No timezone found.</p>
                  ) : (
                    filteredTimezones.map((tz) => (
                      <button
                        key={tz}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                          tz === timezone && 'bg-accent'
                        )}
                        onClick={() => {
                          setTimezone(tz);
                          setTzOpen(false);
                          setTzSearch('');
                        }}
                      >
                        <Check className={cn('h-4 w-4 shrink-0', tz === timezone ? 'opacity-100' : 'opacity-0')} />
                        {tz}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {canEdit && (
            <div className="flex justify-end border-t pt-4">
              <PlanGate>
                <Button onClick={handleSave} disabled={saving || !hasChanges}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </PlanGate>
            </div>
          )}
        </CardContent>
      </Card>

      <BusinessHoursSettings />
      <HolidayEditor scope="company" canEdit={canEdit} />
      <TeamAvailabilityDashboard />

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Session Timeout
          </CardTitle>
          <CardDescription>
            Inactive conversations will automatically close after this many hours. When a contact messages again, a new session is created.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              id="session-timeout"
              type="number"
              min={1}
              max={720}
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(Number(e.target.value))}
              disabled={!canEdit}
              className="w-24"
            />
            <Label htmlFor="session-timeout" className="text-sm text-muted-foreground">
              hours
            </Label>
          </div>
          {canEdit && (
            <div className="flex justify-end border-t pt-4">
              <PlanGate>
                <Button
                  onClick={async () => {
                    if (sessionTimeout < 1 || sessionTimeout > 720) {
                      toast.error('Session timeout must be between 1 and 720 hours');
                      return;
                    }
                    setSavingTimeout(true);
                    try {
                      const { data } = await api.put('/company', { session_timeout_hours: sessionTimeout });
                      setCompany(data.company);
                      toast.success('Session timeout updated');
                    } catch {
                      toast.error('Failed to update session timeout');
                    } finally {
                      setSavingTimeout(false);
                    }
                  }}
                  disabled={savingTimeout || sessionTimeout === (company?.session_timeout_hours ?? 24)}
                >
                  {savingTimeout && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </PlanGate>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete Company
            </CardTitle>
            <CardDescription>
              This will permanently delete the company and all its data, including channels, conversations, and contacts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <PlanGate>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </PlanGate>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {companyName || 'this company'}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the company, all channels, conversations, contacts, and other data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Delete Company
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
