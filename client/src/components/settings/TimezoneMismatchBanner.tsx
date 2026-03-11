import { useState, useEffect } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

const DISMISSED_KEY = 'reply-flow-tz-mismatch-dismissed';

interface DismissedState {
  browserTz: string;
  companyTz: string;
}

function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Shows a banner when the user's browser timezone differs from the company timezone.
 * Dismissal is persisted until either timezone changes.
 */
export default function TimezoneMismatchBanner() {
  const { companyTimezone, hasPermission, refresh } = useSession();
  const [visible, setVisible] = useState(false);
  const [switching, setSwitching] = useState(false);
  const browserTz = getBrowserTimezone();

  useEffect(() => {
    if (!companyTimezone || companyTimezone === browserTz) {
      setVisible(false);
      return;
    }

    // Check if this exact mismatch was already dismissed
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) {
        const dismissed: DismissedState = JSON.parse(raw);
        if (dismissed.browserTz === browserTz && dismissed.companyTz === companyTimezone) {
          setVisible(false);
          return;
        }
      }
    } catch {
      // ignore parse errors
    }

    setVisible(true);
  }, [companyTimezone, browserTz]);

  const handleDismiss = () => {
    const state: DismissedState = { browserTz, companyTz: companyTimezone };
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(state));
    setVisible(false);
  };

  const handleSwitch = async () => {
    setSwitching(true);
    try {
      await api.put('/company', { timezone: browserTz });
      const state: DismissedState = { browserTz, companyTz: browserTz };
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(state));
      await refresh();
      toast.success(`Company timezone updated to ${browserTz}`);
      setVisible(false);
    } catch {
      toast.error('Failed to update timezone');
    } finally {
      setSwitching(false);
    }
  };

  if (!visible) return null;

  const canEdit = hasPermission('company_settings', 'edit');

  return (
    <div className="flex items-center gap-3 border-b bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
      <Globe className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1 text-xs text-amber-800 dark:text-amber-200">
        Your browser timezone is <span className="font-medium">{browserTz}</span>, but your company
        timezone is set to <span className="font-medium">{companyTimezone}</span>.
        {' '}All scheduled times use the company timezone.
      </p>
      <div className="flex items-center gap-1.5">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleSwitch}
            disabled={switching}
          >
            Switch to {browserTz}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
