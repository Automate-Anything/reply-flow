import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MessageSquareOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import SectionCard from './SectionCard';

type AutoReplyTrigger = 'outside_hours' | 'all_unavailable';

function OptionButton({ selected, onClick, children }: {
  selected: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  );
}

interface Props {
  autoReplyEnabled: boolean;
  autoReplyMessage: string | null;
  autoReplyTrigger: AutoReplyTrigger;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updates: {
    auto_reply_enabled: boolean;
    auto_reply_message: string | null;
    auto_reply_trigger: AutoReplyTrigger;
  }) => Promise<void>;
}

export default function AutoReplySection({
  autoReplyEnabled, autoReplyMessage, autoReplyTrigger,
  isExpanded, onToggle, onSave,
}: Props) {
  const [draftEnabled, setDraftEnabled] = useState(autoReplyEnabled);
  const [draftMessage, setDraftMessage] = useState(autoReplyMessage || '');
  const [draftTrigger, setDraftTrigger] = useState<AutoReplyTrigger>(autoReplyTrigger);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isExpanded) return;
    setDraftEnabled(autoReplyEnabled);
    setDraftMessage(autoReplyMessage || '');
    setDraftTrigger(autoReplyTrigger);
  }, [autoReplyEnabled, autoReplyMessage, autoReplyTrigger, isExpanded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        auto_reply_enabled: draftEnabled,
        auto_reply_message: draftEnabled ? (draftMessage.trim() || null) : (autoReplyMessage || null),
        auto_reply_trigger: draftTrigger,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftEnabled(autoReplyEnabled);
    setDraftMessage(autoReplyMessage || '');
    setDraftTrigger(autoReplyTrigger);
    onToggle();
  };

  const isConfigured = autoReplyEnabled;

  const triggerLabels: Record<AutoReplyTrigger, string> = {
    outside_hours: 'Outside business hours',
    all_unavailable: 'When all members are away',
  };

  const summaryText = autoReplyEnabled
    ? `Enabled — ${triggerLabels[autoReplyTrigger]}`
    : 'Disabled — no auto-reply will be sent';

  return (
    <SectionCard
      icon={<MessageSquareOff className="h-4 w-4" />}
      title="Auto-Reply"
      isConfigured={isConfigured}
      summary={summaryText}
      statusLabel={autoReplyEnabled ? 'On' : 'Off'}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs">Enable Auto-Reply</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically reply when AI is off for this channel.
            </p>
          </div>
          <Switch
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
          />
        </div>

        {draftEnabled && (
          <>
            <div>
              <Label className="text-xs">When to send</Label>
              <div className="grid gap-2 mt-1.5">
                <OptionButton
                  selected={draftTrigger === 'outside_hours'}
                  onClick={() => setDraftTrigger('outside_hours')}
                >
                  <div>
                    <p className="text-sm font-medium">Outside business hours</p>
                    <p className="text-xs text-muted-foreground">
                      Send when the current time is outside your company's business hours
                    </p>
                  </div>
                </OptionButton>
                <OptionButton
                  selected={draftTrigger === 'all_unavailable'}
                  onClick={() => setDraftTrigger('all_unavailable')}
                >
                  <div>
                    <p className="text-sm font-medium">When all members are away</p>
                    <p className="text-xs text-muted-foreground">
                      Send when every team member has set their status to unavailable
                    </p>
                  </div>
                </OptionButton>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Auto-reply message</Label>
              <textarea
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                rows={3}
                placeholder="e.g. Thanks for reaching out! We're currently unavailable but will get back to you as soon as possible."
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Auto-reply only sends on the first message of a new conversation.
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}
