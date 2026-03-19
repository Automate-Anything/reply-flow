import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Sparkles, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

// --- Types ---

interface StructuredRule {
  condition: { type: 'keyword' | 'contact_tag' | 'sentiment'; value: string };
  actions: Array<{ type: string; value: string; label?: string }>;
}

interface ChannelClassificationConfig {
  classification_override: string;
  classification_mode: string | null;
  classification_auto_classify: boolean | null;
  classification_rules: string | null;
  classification_structured_rules: StructuredRule[];
}

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
    if (patch.type && patch.type !== rule.condition.type) {
      newCondition.value = '';
    }
    onChange({ ...rule, condition: newCondition });
  };

  const updateAction = (index: number, patch: Partial<StructuredRule['actions'][0]>) => {
    const actions = [...rule.actions];
    actions[index] = { ...actions[index], ...patch };
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

// --- Main component ---

export default function ChannelClassificationSettings({ channelId }: { channelId: number | string }) {
  const [config, setConfig] = useState<ChannelClassificationConfig | null>(null);
  const [companyMode, setCompanyMode] = useState<'company' | 'per_channel' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [companyRes, channelRes] = await Promise.all([
          api.get('/classification/company-settings'),
          api.get(`/classification/channel-settings/${channelId}`),
        ]);
        if (cancelled) return;
        setCompanyMode(companyRes.data.classification_config_mode || 'company');
        setConfig({
          classification_override: channelRes.data.classification_override || 'disabled',
          classification_mode: channelRes.data.classification_mode || 'suggest',
          classification_auto_classify: channelRes.data.classification_auto_classify ?? false,
          classification_rules: channelRes.data.classification_rules || '',
          classification_structured_rules: channelRes.data.classification_structured_rules || [],
        });
      } catch {
        if (!cancelled) toast.error('Failed to load classification settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.put(`/classification/channel-settings/${channelId}`, config);
      toast.success('Channel classification settings saved');
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
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!config || companyMode === null) return null;

  // Company-wide mode: show a message linking to company settings
  if (companyMode === 'company') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Classification
          </CardTitle>
          <CardDescription>
            Classification is configured company-wide.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Classification settings are managed at the company level and apply to all channels.
          </p>
          <Link
            to="/settings/conversations"
            className="mt-2 inline-block text-sm text-primary hover:underline"
          >
            Go to company settings &rarr;
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Per-channel mode: show full config form
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Classification
        </CardTitle>
        <CardDescription>Configure classification settings for this channel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={config.classification_mode || 'suggest'}
              onValueChange={(v) => setConfig({ ...config, classification_mode: v })}
              disabled={saving}
            >
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
            <Label htmlFor="channel-auto-classify">Auto-classify new conversations</Label>
            <Switch
              id="channel-auto-classify"
              checked={config.classification_auto_classify ?? false}
              onCheckedChange={(v) => setConfig({ ...config, classification_auto_classify: v })}
              disabled={saving}
            />
          </div>

          <StructuredRulesBuilder
            rules={config.classification_structured_rules || []}
            onChange={(rules) => setConfig({ ...config, classification_structured_rules: rules })}
            disabled={saving}
          />

          <div className="space-y-2">
            <Label>Additional instructions for the AI</Label>
            <Textarea
              value={config.classification_rules || ''}
              onChange={(e) => setConfig({ ...config, classification_rules: e.target.value })}
              placeholder="Additional rules for this channel..."
              rows={3}
              disabled={saving}
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          <Link to="/settings/conversations" className="text-primary hover:underline">
            Company-level classification settings &rarr;
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
