import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Building2 } from 'lucide-react';

type Status = 'loading' | 'ready' | 'accepting' | 'success' | 'error';

interface InvitePreview {
  email: string;
  expires_at: string;
  accepted_at: string | null;
  company_name: string;
  role_name: string;
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, loading: sessionLoading, companyId, refresh } = useSession();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  // If user already has a company, they can't accept
  const alreadyInCompany = !!companyId;

  const fetchPreview = useCallback(async () => {
    try {
      const { data } = await api.get<{ invitation: InvitePreview }>(
        `/team/invite-preview/${token}`
      );
      const inv = data.invitation;

      if (inv.accepted_at) {
        setStatus('error');
        setErrorMsg('This invitation has already been accepted.');
        return;
      }

      if (new Date(inv.expires_at) < new Date()) {
        setStatus('error');
        setErrorMsg('This invitation has expired.');
        return;
      }

      setPreview(inv);
      setCompanyName(inv.company_name);
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMsg('This invitation link is invalid or has been revoked.');
    }
  }, [token]);

  useEffect(() => {
    if (sessionLoading) return;

    if (!isAuthenticated) {
      navigate(`/auth?redirect=/invite/${token}`, { replace: true });
      return;
    }

    if (alreadyInCompany) {
      setStatus('error');
      setErrorMsg(
        'You already belong to a company. You must leave your current company before accepting a new invitation.'
      );
      return;
    }

    fetchPreview();
  }, [sessionLoading, isAuthenticated, alreadyInCompany, navigate, token, fetchPreview]);

  const handleAccept = async () => {
    setStatus('accepting');
    try {
      const { data } = await api.post('/team/accept-invite', { token });
      setCompanyName(data.company?.name || companyName);
      setStatus('success');
      await refresh();
    } catch (err: unknown) {
      setStatus('error');
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to accept invitation';
      setErrorMsg(msg);
    }
  };

  if (sessionLoading || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6 pt-6">
          {status === 'ready' && preview && (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Building2 className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Team Invitation</h2>
                <p className="text-sm text-muted-foreground">
                  You've been invited to join
                </p>
                <p className="text-lg font-medium">{preview.company_name}</p>
                <Badge variant="secondary" className="capitalize">
                  {preview.role_name}
                </Badge>
              </div>
              <Button className="w-full" onClick={handleAccept}>
                Accept Invitation
              </Button>
            </>
          )}

          {status === 'accepting' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Joining {companyName}...
              </p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-xl font-semibold">Welcome!</h2>
              <p className="text-sm text-muted-foreground">
                You've successfully joined {companyName}.
              </p>
              <Button
                className="mt-2 w-full"
                onClick={() => navigate('/', { replace: true })}
              >
                Go to Dashboard
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold">Unable to Accept</h2>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => navigate('/', { replace: true })}
              >
                Go to Dashboard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
