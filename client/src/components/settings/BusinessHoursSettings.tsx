import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Clock } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import BusinessHoursEditor, {
  getDefaultBusinessHours,
  type BusinessHours,
} from './BusinessHoursEditor';

export default function BusinessHoursSettings() {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [businessHours, setBusinessHours] = useState<BusinessHours | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<BusinessHours>(getDefaultBusinessHours());

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      const bh = data.company.business_hours as BusinessHours | null;
      setBusinessHours(bh);
      setDraft(bh || getDefaultBusinessHours());
      setTimezone(data.company.timezone || 'UTC');
    } catch {
      toast.error('Failed to load business hours');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(businessHours || getDefaultBusinessHours());
  }, [draft, businessHours]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/company', { business_hours: draft });
      setBusinessHours(draft);
      toast.success('Business hours updated');
    } catch {
      toast.error('Failed to update business hours');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Business Hours
        </CardTitle>
        <CardDescription>
          Set when your team is available. These hours are used across the platform, including AI scheduling.
          All times are in <span className="font-medium">{timezone}</span> timezone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <BusinessHoursEditor
          value={draft}
          onChange={setDraft}
          disabled={!canEdit}
        />

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
  );
}
