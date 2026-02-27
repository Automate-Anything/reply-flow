import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceAI } from '@/hooks/useWorkspaceAI';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import AIProfileWizard from '@/components/settings/AIProfileWizard';
import type { ScheduleData } from '@/components/settings/AIProfileWizard';
import { getDefaultBusinessHours } from '@/components/settings/BusinessHoursEditor';

export default function AIProfilePage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const { profile, loadingProfile, updateProfile } = useWorkspaceAI(activeWorkspaceId);
  const [schedule, setSchedule] = useState<ScheduleData>({
    default_language: 'en',
    business_hours: getDefaultBusinessHours(),
  });
  const [loadingSchedule, setLoadingSchedule] = useState(true);

  const fetchSchedule = useCallback(async () => {
    if (!activeWorkspaceId) {
      setLoadingSchedule(false);
      return;
    }
    setLoadingSchedule(true);
    try {
      const { data } = await api.get(`/workspaces/${activeWorkspaceId}`);
      const ws = data.workspace;
      setSchedule({
        default_language: ws.default_language || 'en',
        business_hours: ws.business_hours || getDefaultBusinessHours(),
      });
    } catch {
      toast.error('Failed to load schedule settings');
    } finally {
      setLoadingSchedule(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const handleSaveSchedule = useCallback(async (data: ScheduleData) => {
    if (!activeWorkspaceId) return;
    const { data: res } = await api.put(`/workspaces/${activeWorkspaceId}`, {
      default_language: data.default_language,
      business_hours: data.business_hours,
    });
    const ws = res.workspace;
    setSchedule({
      default_language: ws.default_language || 'en',
      business_hours: ws.business_hours || getDefaultBusinessHours(),
    });
  }, [activeWorkspaceId]);

  if (!activeWorkspaceId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bot className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Select a workspace from the sidebar to configure the AI profile.
          </p>
        </div>
      </div>
    );
  }

  const loading = loadingProfile || loadingSchedule;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">{activeWorkspace?.name}</h2>
        <p className="text-sm text-muted-foreground">
          Configure how the AI agent communicates with customers.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <AIProfileWizard
          profile={profile}
          onSave={updateProfile}
          schedule={schedule}
          onSaveSchedule={handleSaveSchedule}
        />
      )}
    </div>
  );
}
