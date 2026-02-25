import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAISettings } from '@/hooks/useAISettings';

export default function AISettingsPanel() {
  const { settings, loading, updateSettings } = useAISettings();
  const [prompt, setPrompt] = useState('');
  const [maxTokens, setMaxTokens] = useState('500');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrompt(settings.system_prompt);
    setMaxTokens(String(settings.max_tokens));
  }, [settings]);

  const handleToggle = async () => {
    await updateSettings({ is_enabled: !settings.is_enabled });
    toast.success(settings.is_enabled ? 'AI agent disabled' : 'AI agent enabled');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        system_prompt: prompt,
        max_tokens: Number(maxTokens) || 500,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('AI settings saved');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <CardTitle>AI Agent</CardTitle>
            <CardDescription>
              Configure the AI assistant that auto-replies to incoming messages
            </CardDescription>
          </div>
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.is_enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                settings.is_enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>System Prompt</Label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Describe how the AI should behave..."
          />
          <p className="text-xs text-muted-foreground">
            This prompt sets the personality and behavior of the AI assistant.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Max Response Length (tokens)</Label>
          <Input
            type="number"
            min="100"
            max="4000"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className="w-32"
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saved ? (
            <>
              <Check className="h-4 w-4" />
              Saved
            </>
          ) : saving ? (
            'Saving...'
          ) : (
            'Save Changes'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
