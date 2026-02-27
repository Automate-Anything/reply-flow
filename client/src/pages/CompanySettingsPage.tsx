import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { Loader2, Building2, LogOut } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
}

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const { hasPermission, role, refresh, companyName } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const fetchCompany = useCallback(async () => {
    try {
      const [companyRes, membersRes] = await Promise.all([
        api.get('/company'),
        api.get('/team/members').catch(() => ({ data: { members: [] } })),
      ]);
      setCompany(companyRes.data.company);
      setName(companyRes.data.company.name);
      setMemberCount(membersRes.data.members.length);
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

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await api.post('/team/leave');
      await refresh();
      navigate('/onboarding', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to leave company';
      toast.error(msg);
      setLeaving(false);
    }
  };

  const isOwner = role === 'owner';
  const canLeave = !isOwner || memberCount === 1;
  const hasChanges = company && name.trim() !== company.name;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your company information.
        </p>
      </div>

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

      {canLeave && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm font-medium">
                {isOwner ? 'Delete Company' : 'Leave Company'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isOwner
                  ? 'You are the only member. This will permanently delete the company and all its data.'
                  : 'You will lose access to all company data. This cannot be undone.'}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  {isOwner ? 'Delete' : 'Leave'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isOwner ? 'Delete' : 'Leave'} {companyName || 'this company'}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {isOwner
                      ? 'This will permanently delete the company, all channels, conversations, contacts, and other data. This cannot be undone.'
                      : 'You will be removed from the company and lose access to all its data. You\'ll need a new invitation to rejoin.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleLeave}
                    disabled={leaving}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {leaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {isOwner ? 'Delete Company' : 'Leave Company'}
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
