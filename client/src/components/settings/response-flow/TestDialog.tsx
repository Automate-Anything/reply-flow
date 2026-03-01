import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FlaskConical } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ProfileData } from '@/hooks/useCompanyAI';
import api from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileData: ProfileData;
  channelId?: number;
  agentId?: string;
}

interface TestResult {
  matched_scenario: string | null;
  response: string;
}

export default function TestDialog({ open, onOpenChange, profileData, channelId, agentId }: Props) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await api.post('/ai/test-reply', {
        profile_data: agentId ? undefined : profileData,
        message: message.trim(),
        channelId,
        agentId,
      });
      setResult(data);
    } catch (err) {
      setError('Failed to test message. Please try again.');
      console.error('Test reply error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Test Message
          </DialogTitle>
          <DialogDescription>
            Type a sample message to see how the AI would respond with your current configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="e.g. Hi, I'd like to book an appointment for next Tuesday at 3pm."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleTest();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                Ctrl+Enter to test
              </p>
              <Button
                size="sm"
                onClick={handleTest}
                disabled={!message.trim() || loading}
                className="h-8"
              >
                {loading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                )}
                Test
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Matched:</span>
                <Badge variant={result.matched_scenario ? 'default' : 'secondary'}>
                  {result.matched_scenario || 'Default (no scenario matched)'}
                </Badge>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">AI Response:</p>
                <p className="text-sm whitespace-pre-wrap">{result.response}</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
