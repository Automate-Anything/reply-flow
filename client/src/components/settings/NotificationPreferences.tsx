import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

const NOTIFICATION_TYPES = [
  {
    group: 'Assignments',
    items: [
      { key: 'assignment', label: 'Conversation assigned to you' },
      { key: 'share', label: 'Something shared with you' },
    ],
  },
  {
    group: 'Handoff',
    items: [
      { key: 'handoff', label: 'Conversation handed off to you' },
    ],
  },
  {
    group: 'Messages',
    items: [
      { key: 'message_assigned', label: 'New message in assigned conversation' },
      { key: 'message_accessible', label: 'New message in any accessible conversation' },
    ],
  },
  {
    group: 'Scheduling',
    items: [
      { key: 'snooze_set', label: 'Snoozed message reminder' },
      { key: 'schedule_set', label: 'Scheduled message created' },
      { key: 'schedule_sent', label: 'Scheduled message sent' },
    ],
  },
  {
    group: 'Activity',
    items: [
      { key: 'status_change', label: 'Conversation status changed' },
      { key: 'contact_note', label: 'Note added to assigned contact' },
    ],
  },
];

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications/preferences').then(({ data }) => {
      setPrefs(data.preferences);
      setLoading(false);
    }).catch(() => {
      toast.error('Failed to load notification preferences');
      setLoading(false);
    });
  }, []);

  const handleToggle = async (key: string, value: boolean) => {
    const previous = { ...prefs };
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    try {
      await api.put('/notifications/preferences', { preferences: updated });
    } catch {
      setPrefs(previous); // revert on error
      toast.error('Failed to update preference');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {NOTIFICATION_TYPES.map((group, groupIdx) => (
        <div key={group.group}>
          <h4 className="text-sm font-medium mb-3">{group.group}</h4>
          <div className="space-y-3">
            {group.items.map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <Label htmlFor={`notif-${item.key}`} className="text-sm font-normal cursor-pointer">
                  {item.label}
                </Label>
                <Switch
                  id={`notif-${item.key}`}
                  checked={prefs[item.key] ?? true}
                  onCheckedChange={(v) => handleToggle(item.key, v)}
                />
              </div>
            ))}
          </div>
          {groupIdx < NOTIFICATION_TYPES.length - 1 && <Separator className="mt-4" />}
        </div>
      ))}
    </div>
  );
}
