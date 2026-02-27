import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Building2 } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
}

export default function CompanySettingsPage() {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      setCompany(data.company);
      setName(data.company.name);
    } catch {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/company', { name: name.trim() });
      setCompany(data.company);
      toast.success('Company settings updated');
    } catch {
      toast.error('Failed to update company settings');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = company && name.trim() !== company.name;

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
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 space-y-1.5">
              <label htmlFor="company-name" className="text-sm font-medium">
                Company Name
              </label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
                placeholder="Your company name"
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
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
