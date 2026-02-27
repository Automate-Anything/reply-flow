import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { useChannelAgent } from '@/hooks/useChannelAgent';

interface Props {
  channelId: number;
  hasWorkspace: boolean;
}

export default function ChannelAgentSettings({ channelId, hasWorkspace }: Props) {
  const {
    settings,
    loadingSettings,
    updateSettings,
  } = useChannelAgent(hasWorkspace ? channelId : undefined);

  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<string | null>(null);
  const [greetingOverride, setGreetingOverride] = useState<string | null>(null);
  const [maxTokensOverride, setMaxTokensOverride] = useState<string>('');
  const [initialized, setInitialized] = useState(false);

  // Initialize local state from settings once loaded
  if (!loadingSettings && !initialized && hasWorkspace) {
    setCustomInstructions(settings.custom_instructions);
    setGreetingOverride(settings.greeting_override);
    setMaxTokensOverride(settings.max_tokens_override ? String(settings.max_tokens_override) : '');
    setInitialized(true);
  }

  if (!hasWorkspace) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Bot className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Assign this channel to a workspace to configure AI agent settings.
        </p>
      </div>
    );
  }

  if (loadingSettings) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const handleToggle = async () => {
    setToggling(true);
    try {
      await updateSettings({ is_enabled: !settings.is_enabled });
      toast.success(settings.is_enabled ? 'Agent disabled for this channel' : 'Agent enabled for this channel');
    } catch {
      toast.error('Failed to toggle agent');
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        custom_instructions: customInstructions || null,
        greeting_override: greetingOverride || null,
        max_tokens_override: maxTokensOverride ? Number(maxTokensOverride) : null,
      });
      toast.success('Agent settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Per-channel toggle */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Agent Enabled</p>
          <p className="text-xs text-muted-foreground">
            Enable or disable the AI agent for this specific channel.
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggling}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
            toggling ? 'cursor-wait opacity-60' : 'cursor-pointer'
          } ${settings.is_enabled ? 'bg-primary' : 'bg-muted'}`}
        >
          <span
            className={`pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform ${
              settings.is_enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          >
            {toggling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </span>
        </button>
      </div>

      {/* Override fields */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Custom Instructions</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Additional instructions specific to this channel (optional)"
            value={customInstructions || ''}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            These instructions are appended to the workspace AI profile.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Greeting Override</Label>
          <Input
            placeholder="Override workspace greeting for this channel (optional)"
            value={greetingOverride || ''}
            onChange={(e) => setGreetingOverride(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Max Tokens Override</Label>
          <Input
            type="number"
            placeholder="Override workspace max tokens (optional)"
            value={maxTokensOverride}
            onChange={(e) => setMaxTokensOverride(e.target.value)}
            min={100}
            max={4000}
          />
        </div>

        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
