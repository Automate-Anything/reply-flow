import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

interface ChannelClassificationConfig {
  classification_override: string;
  classification_mode: string | null;
  classification_auto_classify: boolean | null;
  classification_rules: string | null;
}

export default function ChannelClassificationSettings({ channelId }: { channelId: number | string }) {
  const [config, setConfig] = useState<ChannelClassificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/classification/channel-settings/${channelId}`)
      .then(({ data }) => setConfig(data))
      .catch(() => toast.error('Failed to load channel classification settings'))
      .finally(() => setLoading(false));
  }, [channelId]);

  const save = async () => {
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

  if (loading || !config) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Classification
        </CardTitle>
        <CardDescription>
          Override company classification settings for this channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Classification for this channel</Label>
          <Select
            value={config.classification_override}
            onValueChange={(v) => setConfig({ ...config, classification_override: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company_defaults">Use company defaults</SelectItem>
              <SelectItem value="custom">Custom settings</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {config.classification_override === 'custom' && (
          <>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={config.classification_mode ?? 'suggest'}
                onValueChange={(v) => setConfig({ ...config, classification_mode: v })}
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
              />
            </div>

            <div className="space-y-2">
              <Label>Channel-specific rules</Label>
              <Textarea
                value={config.classification_rules ?? ''}
                onChange={(e) => setConfig({ ...config, classification_rules: e.target.value })}
                placeholder="Additional rules for this channel..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                These rules are used in addition to company-level rules.
              </p>
            </div>
          </>
        )}

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>

        <p className="text-xs text-muted-foreground">
          <a href="/settings/conversations" className="text-primary hover:underline">Company-level classification settings →</a>
        </p>
      </CardContent>
    </Card>
  );
}
