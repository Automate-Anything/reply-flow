import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Building2 } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  timezone: string;
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
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [tzInput, setTzInput] = useState('UTC');

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      setCompany(data.company);
      setName(data.company.name);
      setTimezone(data.company.timezone || 'UTC');
      setTzInput(data.company.timezone || 'UTC');
    } catch {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  const handleTzBlur = () => {
    // Validate the timezone input on blur
    if (TIMEZONES.includes(tzInput)) {
      setTimezone(tzInput);
    } else {
      // Reset to current valid value
      setTzInput(timezone);
    }
  };

  const hasChanges = useMemo(() => {
    if (!company) return false;
    return name.trim() !== company.name || timezone !== (company.timezone || 'UTC');
  }, [company, name, timezone]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/company', {
        name: name.trim(),
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
            <Label htmlFor="company-timezone">Timezone</Label>
            <p className="text-xs text-muted-foreground">
              Used for business hours and scheduling across the platform.
            </p>
            <Input
              id="company-timezone"
              list="tz-list"
              value={tzInput}
              onChange={(e) => {
                setTzInput(e.target.value);
                if (TIMEZONES.includes(e.target.value)) {
                  setTimezone(e.target.value);
                }
              }}
              onBlur={handleTzBlur}
              disabled={!canEdit}
              placeholder="e.g., America/New_York"
            />
            <datalist id="tz-list">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>

          {canEdit && (
            <div className="flex justify-end border-t pt-4">
              <Button onClick={handleSave} disabled={saving || !hasChanges}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
