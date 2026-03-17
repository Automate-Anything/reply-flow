import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ProfileData } from '@/hooks/useCompanyAI';

interface ClassificationSettingsProps {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
}

export default function ClassificationSettings({ profileData, onSave }: ClassificationSettingsProps) {
  const config = (profileData as Record<string, unknown>).classification as
    | { enabled?: boolean; rules?: string; auto_classify_new?: boolean }
    | undefined;

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [autoClassifyNew, setAutoClassifyNew] = useState(config?.auto_classify_new ?? false);
  const [rules, setRules] = useState(config?.rules ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = {
        ...profileData,
        classification: { enabled, rules, auto_classify_new: autoClassifyNew },
      };
      await onSave({ profile_data: updated });
      toast.success('Classification settings saved');
    } catch {
      toast.error('Failed to save classification settings');
    } finally {
      setSaving(false);
    }
  }, [profileData, onSave, enabled, rules, autoClassifyNew]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI Classification
        </CardTitle>
        <CardDescription>
          Automatically classify conversations with labels, priority, status, and contact tags.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="classification-enabled">Enable classification</Label>
          <Switch
            id="classification-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-classify">Auto-classify new conversations</Label>
              <Switch
                id="auto-classify"
                checked={autoClassifyNew}
                onCheckedChange={setAutoClassifyNew}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="classification-rules">Classification rules</Label>
              <Textarea
                id="classification-rules"
                placeholder="e.g., If the customer mentions billing or payments, apply the 'Billing' label and set priority to High."
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Natural language instructions that guide the AI when classifying conversations.
              </p>
            </div>
          </>
        )}

        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
