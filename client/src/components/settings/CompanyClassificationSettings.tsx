import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Save, Sparkles, Plus, Trash2, ChevronRight, Phone } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { type ChannelInfo, formatChannelName } from '@/components/settings/channelHelpers';

// --- Types ---

interface StructuredRule {
  condition: { type: 'keyword' | 'contact_tag' | 'sentiment'; value: string };
  actions: Array<{ type: string; value: string; label?: string }>;
}

interface CompanyClassificationConfig {
  classification_enabled: boolean;
  classification_mode: string;
  classification_auto_classify: boolean;
  classification_rules: string | null;
  classification_config_mode: 'company' | 'per_channel';
  classification_structured_rules: StructuredRule[];
}

interface ChannelClassificationConfig {
  classification_override: string;
  classification_mode: string | null;
  classification_auto_classify: boolean | null;
  classification_rules: string | null;
  classification_structured_rules: StructuredRule[];
}

type ConfigMode = 'company' | 'per_channel';

const CONDITION_TYPES = [
  { value: 'keyword', label: 'Keyword' },
  { value: 'contact_tag', label: 'Contact Tag' },
  { value: 'sentiment', label: 'Sentiment' },
] as const;

const SENTIMENT_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'frustrated', label: 'Frustrated' },
] as const;

const ACTION_TYPES = [
  { value: 'add_label', label: 'Add Label' },
  { value: 'set_priority', label: 'Set Priority' },
  { value: 'set_status', label: 'Set Status' },
  { value: 'add_contact_tag', label: 'Add Contact Tag' },
  { value: 'add_to_contact_list', label: 'Add to Contact List' },
] as const;

// --- Structured Rules Builder ---

function StructuredRulesBuilder({
  rules,
  onChange,
  disabled,
}: {
  rules: StructuredRule[];
  onChange: (rules: StructuredRule[]) => void;
  disabled: boolean;
}) {
  const addRule = () => {
    onChange([
      ...rules,
      {
        condition: { type: 'keyword', value: '' },
        actions: [{ type: 'add_label', value: '', label: '' }],
      },
    ]);
  };

  const updateRule = (index: number, rule: StructuredRule) => {
    const updated = [...rules];
    updated[index] = rule;
    onChange(updated);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <Label>Structured Rules</Label>
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No structured rules configured. Add rules to automatically classify conversations based on conditions.
        </p>
      )}
      {rules.map((rule, i) => (
        <RuleEditor
          key={i}
          rule={rule}
          onChange={(r) => updateRule(i, r)}
          onRemove={() => removeRule(i)}
          disabled={disabled}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={disabled}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Add Rule
      </Button>
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
  disabled,
}: {
  rule: StructuredRule;
  onChange: (rule: StructuredRule) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const updateCondition = (patch: Partial<StructuredRule['condition']>) => {
    const newCondition = { ...rule.condition, ...patch };
    // Reset value when type changes
    if (patch.type && patch.type !== rule.condition.type) {
      newCondition.value = '';
    }
    onChange({ ...rule, condition: newCondition });
  };

  const updateAction = (index: number, patch: Partial<StructuredRule['actions'][0]>) => {
    const actions = [...rule.actions];
    actions[index] = { ...actions[index], ...patch };
    // Keep label in sync with value for v1
    if (patch.value !== undefined) {
      actions[index].label = patch.value;
    }
    onChange({ ...rule, actions });
  };

  const addAction = () => {
    onChange({
      ...rule,
      actions: [...rule.actions, { type: 'add_label', value: '', label: '' }],
    });
  };

  const removeAction = (index: number) => {
    if (rule.actions.length <= 1) return;
    onChange({ ...rule, actions: rule.actions.filter((_, i) => i !== index) });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          {/* Condition */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground w-6 shrink-0">IF</span>
            <Select
              value={rule.condition.type}
              onValueChange={(v) => updateCondition({ type: v as StructuredRule['condition']['type'] })}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map((ct) => (
                  <SelectItem key={ct.value} value={ct.value}>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rule.condition.type === 'sentiment' ? (
              <Select
                value={rule.condition.value || ''}
                onValueChange={(v) => updateCondition({ value: v })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder="Select sentiment" />
                </SelectTrigger>
                <SelectContent>
                  {SENTIMENT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="h-8 flex-1"
                placeholder={rule.condition.type === 'keyword' ? 'Enter keyword...' : 'Enter tag name...'}
                value={rule.condition.value}
                onChange={(e) => updateCondition({ value: e.target.value })}
                disabled={disabled}
              />
            )}
          </div>

          {/* Actions */}
          {rule.actions.map((action, ai) => (
            <div key={ai} className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground w-6 shrink-0">
                {ai === 0 ? 'THEN' : 'AND'}
              </span>
              <Select
                value={action.type}
                onValueChange={(v) => updateAction(ai, { type: v })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((at) => (
                    <SelectItem key={at.value} value={at.value}>
                      {at.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1"
                placeholder="Value..."
                value={action.value}
                onChange={(e) => updateAction(ai, { value: e.target.value })}
                disabled={disabled}
              />
              {rule.actions.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeAction(ai)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-6 h-7 text-xs"
            onClick={addAction}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add action
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// --- Classification Config Form (shared between company-wide and per-channel) ---

function ClassificationConfigForm({
  mode,
  autoClassify,
  structuredRules,
  customInstructions,
  saving,
  onModeChange,
  onAutoClassifyChange,
  onStructuredRulesChange,
  onCustomInstructionsChange,
  onSave,
}: {
  mode: string;
  autoClassify: boolean;
  structuredRules: StructuredRule[];
  customInstructions: string;
  saving: boolean;
  onModeChange: (v: string) => void;
  onAutoClassifyChange: (v: boolean) => void;
  onStructuredRulesChange: (rules: StructuredRule[]) => void;
  onCustomInstructionsChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Mode</Label>
        <Select value={mode} onValueChange={onModeChange} disabled={saving}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="suggest">Suggest & Confirm</SelectItem>
            <SelectItem value="auto_apply">Auto-Apply</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="auto-classify-toggle">Auto-classify new conversations</Label>
        <Switch
          id="auto-classify-toggle"
          checked={autoClassify}
          onCheckedChange={onAutoClassifyChange}
          disabled={saving}
        />
      </div>

      <StructuredRulesBuilder
        rules={structuredRules}
        onChange={onStructuredRulesChange}
        disabled={saving}
      />

      <div className="space-y-2">
        <Label>Additional instructions for the AI</Label>
        <Textarea
          value={customInstructions}
          onChange={(e) => onCustomInstructionsChange(e.target.value)}
          placeholder="E.g., Mark billing questions as high priority..."
          rows={3}
          disabled={saving}
        />
      </div>

      <Button onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save
      </Button>
    </div>
  );
}

// --- Per-channel collapsible row ---

function ChannelClassificationRow({
  channel,
}: {
  channel: ChannelInfo;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ChannelClassificationConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);

  const fetchConfig = async () => {
    if (config) return; // already loaded
    setLoadingConfig(true);
    try {
      const { data } = await api.get(`/classification/channel-settings/${channel.id}`);
      setConfig(data);
    } catch {
      toast.error('Failed to load channel classification settings');
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleToggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchConfig();
  };

  const isConfigured = config?.classification_override === 'custom';

  const handleSave = async () => {
    if (!config) return;
    setSavingChannel(true);
    try {
      await api.put(`/classification/channel-settings/${channel.id}`, config);
      toast.success('Channel classification settings saved');
    } catch {
      toast.error('Failed to save channel settings');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleEnableChannel = () => {
    if (!config) return;
    setConfig({
      ...config,
      classification_override: 'custom',
      classification_mode: config.classification_mode || 'suggest',
      classification_auto_classify: config.classification_auto_classify ?? false,
      classification_structured_rules: config.classification_structured_rules || [],
      classification_rules: config.classification_rules || '',
    });
  };

  const handleDisableChannel = () => {
    if (!config) return;
    setConfig({ ...config, classification_override: 'disabled' });
  };

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={handleToggleOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium flex-1">{formatChannelName(channel)}</span>
        {config ? (
          <span className="text-xs text-muted-foreground">
            {config.classification_override === 'custom' ? 'Configured' : 'Not configured'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not configured</span>
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-3">
          {loadingConfig ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : config ? (
            <>
              {!isConfigured ? (
                <div className="flex items-center justify-between rounded-lg border border-dashed p-4">
                  <span className="text-sm text-muted-foreground">
                    Classification not configured for this channel
                  </span>
                  <Button size="sm" variant="outline" onClick={handleEnableChannel}>
                    <Plus className="mr-2 h-4 w-4" />
                    Configure
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      onClick={handleDisableChannel}
                    >
                      Reset to default
                    </Button>
                  </div>
                  <ClassificationConfigForm
                    mode={config.classification_mode || 'suggest'}
                    autoClassify={config.classification_auto_classify ?? false}
                    structuredRules={config.classification_structured_rules || []}
                    customInstructions={config.classification_rules || ''}
                    saving={savingChannel}
                    onModeChange={(v) => setConfig({ ...config, classification_mode: v })}
                    onAutoClassifyChange={(v) => setConfig({ ...config, classification_auto_classify: v })}
                    onStructuredRulesChange={(rules) =>
                      setConfig({ ...config, classification_structured_rules: rules })
                    }
                    onCustomInstructionsChange={(v) => setConfig({ ...config, classification_rules: v })}
                    onSave={handleSave}
                  />
                </>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export default function CompanyClassificationSettings() {
  const [config, setConfig] = useState<CompanyClassificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    api
      .get('/classification/company-settings')
      .then(({ data }) =>
        setConfig({
          classification_enabled: data.classification_enabled ?? false,
          classification_mode: data.classification_mode || 'suggest',
          classification_auto_classify: data.classification_auto_classify ?? false,
          classification_rules: data.classification_rules || '',
          classification_config_mode: data.classification_config_mode || 'company',
          classification_structured_rules: data.classification_structured_rules || [],
        }),
      )
      .catch(() => toast.error('Failed to load classification settings'))
      .finally(() => setLoading(false));

    api
      .get('/whatsapp/channels')
      .then(({ data }) => setChannels(data.channels || []))
      .catch(() => console.error('Failed to fetch channels'))
      .finally(() => setChannelsLoading(false));
  }, []);

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!config) return;
    const prev = config.classification_enabled;
    setConfig({ ...config, classification_enabled: enabled });
    try {
      await api.put('/classification/company-settings', {
        ...config,
        classification_enabled: enabled,
      });
    } catch {
      setConfig({ ...config, classification_enabled: prev });
      toast.error('Failed to update classification');
    }
  };

  const handleConfigModeChange = async (newMode: ConfigMode) => {
    if (!config) return;
    const prev = config.classification_config_mode;
    setConfig({ ...config, classification_config_mode: newMode });
    try {
      await api.put('/classification/company-settings', {
        ...config,
        classification_config_mode: newMode,
      });
    } catch {
      setConfig({ ...config, classification_config_mode: prev });
      toast.error('Failed to update mode');
    }
  };

  const handleSaveCompany = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.put('/classification/company-settings', config);
      toast.success('Classification settings saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Classification
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!config) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Classification
        </CardTitle>
        <CardDescription>
          Automatically classify conversations with labels, priority, status, and contact tags.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Master toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="classification-enabled">Enable AI Classification</Label>
          <Switch
            id="classification-enabled"
            checked={config.classification_enabled}
            onCheckedChange={handleToggleEnabled}
          />
        </div>

        {config.classification_enabled && (
          <div className="space-y-4">
            {/* Company-Wide / Per Channel pill bar */}
            <div className="flex items-center gap-2 rounded-lg border p-1">
              <button
                type="button"
                onClick={() =>
                  config.classification_config_mode !== 'company' && handleConfigModeChange('company')
                }
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  config.classification_config_mode === 'company'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Company-Wide
              </button>
              <button
                type="button"
                onClick={() =>
                  config.classification_config_mode !== 'per_channel' &&
                  handleConfigModeChange('per_channel')
                }
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  config.classification_config_mode === 'per_channel'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Per Channel
              </button>
            </div>

            {config.classification_config_mode === 'company' ? (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  One classification configuration applies to all channels.
                </p>
                <ClassificationConfigForm
                  mode={config.classification_mode}
                  autoClassify={config.classification_auto_classify}
                  structuredRules={config.classification_structured_rules}
                  customInstructions={config.classification_rules || ''}
                  saving={saving}
                  onModeChange={(v) => setConfig({ ...config, classification_mode: v })}
                  onAutoClassifyChange={(v) =>
                    setConfig({ ...config, classification_auto_classify: v })
                  }
                  onStructuredRulesChange={(rules) =>
                    setConfig({ ...config, classification_structured_rules: rules })
                  }
                  onCustomInstructionsChange={(v) =>
                    setConfig({ ...config, classification_rules: v })
                  }
                  onSave={handleSaveCompany}
                />
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  Each channel has its own classification settings. Channels without custom
                  configuration will not classify conversations.
                </p>
                {channelsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : channels.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No channels connected yet.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {channels.map((ch) => (
                      <ChannelClassificationRow
                        key={ch.id}
                        channel={ch}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
