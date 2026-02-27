import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Building2, ArrowRight, Plus } from 'lucide-react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface PendingInvitation {
  id: string;
  token: string;
  company_name: string;
  role_name: string;
  expires_at: string;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { companyId, loading: sessionLoading, refresh } = useSession();

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [acceptingToken, setAcceptingToken] = useState<string | null>(null);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [error, setError] = useState('');

  // If user already has a company, redirect to dashboard
  useEffect(() => {
    if (!sessionLoading && companyId) {
      navigate('/', { replace: true });
    }
  }, [sessionLoading, companyId, navigate]);

  // Fetch pending invitations for this user
  useEffect(() => {
    api
      .get<{ invitations: PendingInvitation[] }>('/me/invitations')
      .then(({ data }) => setInvitations(data.invitations))
      .catch(() => {})
      .finally(() => setLoadingInvitations(false));
  }, []);

  const handleAcceptInvitation = async (token: string) => {
    setAcceptingToken(token);
    setError('');
    try {
      await api.post('/team/accept-invite', { token });
      await refresh();
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to accept invitation';
      setError(msg);
      setAcceptingToken(null);
    }
  };

  const handleCreateCompany = async () => {
    setCreatingCompany(true);
    setError('');
    try {
      await api.post('/company/create');
      await refresh();
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to create company';
      setError(msg);
      setCreatingCompany(false);
    }
  };

  if (sessionLoading || loadingInvitations) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasInvitations = invitations.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {hasInvitations ? 'You\'ve been invited' : 'Get started'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {hasInvitations
              ? 'Join an existing team or start fresh.'
              : 'Create a company to begin using Reply Flow.'}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {hasInvitations && (
          <div className="space-y-2">
            {invitations.map((inv) => (
              <button
                key={inv.id}
                onClick={() => handleAcceptInvitation(inv.token)}
                disabled={acceptingToken === inv.token}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">
                    {inv.company_name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Join as{' '}
                    <Badge
                      variant="outline"
                      className="align-middle text-[10px] px-1 py-0"
                    >
                      {inv.role_name}
                    </Badge>
                  </p>
                </div>
                {acceptingToken === inv.token ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        )}

        {hasInvitations && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>
        )}

        <Button
          variant={hasInvitations ? 'ghost' : 'default'}
          className={hasInvitations ? 'w-full text-muted-foreground' : 'w-full'}
          onClick={handleCreateCompany}
          disabled={creatingCompany}
        >
          {creatingCompany ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Plus className="mr-2 size-4" />
          )}
          Create a new company
        </Button>
      </div>
    </div>
  );
}
