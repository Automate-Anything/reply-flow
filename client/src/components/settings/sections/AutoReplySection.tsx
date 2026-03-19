import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MessageSquareOff, Plus, Trash2 } from 'lucide-react';
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

const MAX_VARIANTS = 5;

interface Props {
  autoReplyEnabled: boolean;
  autoReplyMessage: string | null;
  autoReplyMessages: string[];
  autoReplyTrigger: AutoReplyTrigger;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updates: {
    auto_reply_enabled: boolean;
    auto_reply_message: string | null;
    auto_reply_messages: string[];
    auto_reply_trigger: AutoReplyTrigger;
  }) => Promise<void>;
}

function initVariants(messages: string[], singleMessage: string | null): string[] {
  if (messages && messages.length > 0) return messages;
  if (singleMessage) return [singleMessage];
  return [''];
}

export default function AutoReplySection({
  autoReplyEnabled, autoReplyMessage, autoReplyMessages, autoReplyTrigger,
  isExpanded, onToggle, onSave,
}: Props) {
  const [draftEnabled, setDraftEnabled] = useState(autoReplyEnabled);
  const [variants, setVariants] = useState<string[]>(() => initVariants(autoReplyMessages, autoReplyMessage));
  const [draftTrigger, setDraftTrigger] = useState<AutoReplyTrigger>(autoReplyTrigger);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isExpanded) return;
    setDraftEnabled(autoReplyEnabled);
    setVariants(initVariants(autoReplyMessages, autoReplyMessage));
    setDraftTrigger(autoReplyTrigger);
  }, [autoReplyEnabled, autoReplyMessage, autoReplyMessages, autoReplyTrigger, isExpanded]);

  const handleVariantChange = (index: number, value: string) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? value : v)));
  };

  const handleAddVariant = () => {
    if (variants.length < MAX_VARIANTS) {
      setVariants((prev) => [...prev, '']);
    }
  };

  const handleRemoveVariant = (index: number) => {
    if (index === 0) return; // First variant cannot be removed
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nonEmpty = variants.map((v) => v.trim()).filter(Boolean);
      const firstVariant = nonEmpty[0] ?? null;
      await onSave({
        auto_reply_enabled: draftEnabled,
        auto_reply_message: draftEnabled ? firstVariant : (autoReplyMessage || null),
        auto_reply_messages: draftEnabled ? nonEmpty : [],
        auto_reply_trigger: draftTrigger,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftEnabled(autoReplyEnabled);
    setVariants(initVariants(autoReplyMessages, autoReplyMessage));
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

            <div className="space-y-2">
              <Label className="text-xs">Auto-reply messages</Label>
              <p className="text-xs text-muted-foreground">
                Add multiple message variants to avoid repetitive patterns. One will be chosen randomly for each auto-reply.
              </p>
              <div className="space-y-2">
                {variants.map((variant, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Message {index + 1}
                      </p>
                      <div className="relative">
                        <textarea
                          value={variant}
                          onChange={(e) => handleVariantChange(index, e.target.value)}
                          rows={3}
                          placeholder="e.g. Thanks for reaching out! We're currently unavailable but will get back to you as soon as possible."
                          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </div>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveVariant(index)}
                        className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-destructive/30 text-destructive/70 hover:border-destructive hover:bg-destructive/5 hover:text-destructive transition-colors"
                        aria-label={`Remove message ${index + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {variants.length < MAX_VARIANTS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddVariant}
                  className="mt-1 h-7 gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add variant
                </Button>
              )}
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
