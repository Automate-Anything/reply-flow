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

interface CompanyClassificationConfig {
  classification_enabled: boolean;
  classification_mode: string;
  classification_auto_classify: boolean;
  classification_rules: string | null;
}

export default function CompanyClassificationSettings() {
  const [config, setConfig] = useState<CompanyClassificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/classification/company-settings')
      .then(({ data }) => setConfig(data))
      .catch(() => toast.error('Failed to load classification settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
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

  if (loading || !config) return null;

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
        <div className="flex items-center justify-between">
          <Label htmlFor="classification-enabled">Enable AI Classification</Label>
          <Switch
            id="classification-enabled"
            checked={config.classification_enabled}
            onCheckedChange={(v) => setConfig({ ...config, classification_enabled: v })}
          />
        </div>

        {config.classification_enabled && (
          <>
            <div className="space-y-2">
              <Label>Default mode</Label>
              <Select
                value={config.classification_mode}
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
              <Label htmlFor="auto-classify">Auto-classify new conversations</Label>
              <Switch
                id="auto-classify"
                checked={config.classification_auto_classify}
                onCheckedChange={(v) => setConfig({ ...config, classification_auto_classify: v })}
              />
            </div>

            <div className="space-y-2">
              <Label>Classification rules</Label>
              <Textarea
                value={config.classification_rules ?? ''}
                onChange={(e) => setConfig({ ...config, classification_rules: e.target.value })}
                placeholder="E.g., Mark billing questions as high priority..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                These rules apply to all channels unless overridden.
              </p>
            </div>
          </>
        )}

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>

        {config.classification_enabled && (
          <p className="text-xs text-muted-foreground">
            You can override these settings per channel in each channel's settings page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
