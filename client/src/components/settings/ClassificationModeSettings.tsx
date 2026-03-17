import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ClassificationModeSettings() {
  const { hasPermission } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');

  const [mode, setMode] = useState<'auto_apply' | 'suggest'>('suggest');
  const [savedMode, setSavedMode] = useState<'auto_apply' | 'suggest'>('suggest');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchMode = useCallback(async () => {
    try {
      const { data } = await api.get('/classification/settings');
      setMode(data.classification_mode || 'suggest');
      setSavedMode(data.classification_mode || 'suggest');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/classification/settings', { classification_mode: mode });
      setSavedMode(mode);
      toast.success('Classification mode updated');
    } catch {
      toast.error('Failed to update classification mode');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI Classification Mode
        </CardTitle>
        <CardDescription>
          Choose how AI classification results are applied to conversations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Classification behavior</Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as 'auto_apply' | 'suggest')}
            disabled={!canEdit}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="suggest">Suggest & Confirm</SelectItem>
              <SelectItem value="auto_apply">Auto-Apply</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {mode === 'suggest'
              ? 'AI suggests labels, priority, and tags. A team member reviews and accepts or dismisses them.'
              : 'AI automatically applies labels, priority, and tags without manual review. Existing non-default values are never overwritten.'}
          </p>
        </div>

        {canEdit && mode !== savedMode && (
          <div className="flex justify-end border-t pt-4">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
