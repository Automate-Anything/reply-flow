import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Clock, Loader2, Shuffle, UserPlus } from 'lucide-react';
import { PlanGate } from '@/components/auth/PlanGate';
import AutoAssignSettings from './AutoAssignSettings';
import ClassificationModeSettings from './ClassificationModeSettings';

export default function ConversationSettingsTab() {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [sessionTimeout, setSessionTimeout] = useState(24);
  const [savedTimeout, setSavedTimeout] = useState(24);
  const [autoCreateContacts, setAutoCreateContacts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAutoCreate, setSavingAutoCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      const hours = data.company.session_timeout_hours ?? 24;
      setSessionTimeout(hours);
      setSavedTimeout(hours);
      setAutoCreateContacts(data.company.auto_create_contacts ?? true);
    } catch {
      // ignore — AutoAssignSettings handles its own loading
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleToggleAutoCreate = async (checked: boolean) => {
    setSavingAutoCreate(true);
    try {
      await api.put('/company', { auto_create_contacts: checked });
      setAutoCreateContacts(checked);
      toast.success(checked ? 'Auto-create contacts enabled' : 'Auto-create contacts disabled');
    } catch {
      toast.error('Failed to update setting');
    } finally {
      setSavingAutoCreate(false);
    }
  };

  const handleSaveTimeout = async () => {
    if (sessionTimeout < 1 || sessionTimeout > 720) {
      toast.error('Session timeout must be between 1 and 720 hours');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/company', { session_timeout_hours: sessionTimeout });
      const hours = data.company.session_timeout_hours ?? 24;
      setSavedTimeout(hours);
      toast.success('Session timeout updated');
    } catch {
      toast.error('Failed to update session timeout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shuffle className="h-4 w-4" />
            Auto-Assign
          </CardTitle>
          <CardDescription>
            Configure how new incoming conversations are automatically assigned to team members.
            Channel-specific rules take priority over the company-wide default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoAssignSettings />
        </CardContent>
      </Card>

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
              value={loading ? '' : sessionTimeout}
              onChange={(e) => setSessionTimeout(Number(e.target.value))}
              disabled={!canEdit || loading}
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
                  onClick={handleSaveTimeout}
                  disabled={saving || sessionTimeout === savedTimeout}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </PlanGate>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4" />
            Auto-Create Contacts
          </CardTitle>
          <CardDescription>
            Automatically create a contact record when a message is received from an unknown phone number.
            When disabled, messages from unknown numbers will still appear in the inbox but no contact will be created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-create-contacts" className="text-sm">
              {autoCreateContacts ? 'Enabled' : 'Disabled'}
            </Label>
            <PlanGate>
              <Switch
                id="auto-create-contacts"
                checked={autoCreateContacts}
                onCheckedChange={handleToggleAutoCreate}
                disabled={!canEdit || loading || savingAutoCreate}
              />
            </PlanGate>
          </div>
        </CardContent>
      </Card>

      <ClassificationModeSettings />
    </div>
  );
}
