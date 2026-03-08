import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FlaskConical, ChevronDown, ChevronRight, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { useDebugMode } from '@/hooks/useDebugMode';
import { PromptBuilderView } from '@/components/settings/PromptPreviewPanel';
import api from '@/lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileData: ProfileData;
  channelId?: number;
  agentId?: string;
}

interface TestDebug {
  promptSections: Array<{ name: string; content: string }>;
  systemPrompt: string;
  tokens: { input: number; output: number };
  responseTimeMs: number;
  model: string;
  stopReason: string;
  kbEntriesUsed: number;
}

interface TestResult {
  matched_scenario: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  response: string;
  debug?: TestDebug;
}

export default function TestDialog({ open, onOpenChange, profileData, channelId, agentId }: Props) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const { debugMode } = useDebugMode();

  const handleTest = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setShowPrompt(false);
    try {
      const { data } = await api.post('/ai/test-reply', {
        profile_data: agentId ? undefined : profileData,
        message: message.trim(),
        channelId,
        agentId,
        include_debug: debugMode,
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
      <DialogContent className={debugMode && result?.debug ? 'sm:max-w-4xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Test Message
            {debugMode && (
              <Badge variant="outline" className="text-[10px] text-purple-500 border-purple-300">Debug</Badge>
            )}
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Matched:</span>
                <Badge variant={result.matched_scenario ? 'default' : 'secondary'}>
                  {result.matched_scenario || 'Default (no scenario matched)'}
                </Badge>
                {result.confidence && (
                  <Badge variant={
                    result.confidence === 'high' ? 'default' :
                    result.confidence === 'medium' ? 'secondary' : 'destructive'
                  }>
                    {result.confidence} confidence
                  </Badge>
                )}
              </div>

              {/* Debug info bar */}
              {result.debug && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground bg-purple-500/5 border border-purple-300/30 rounded-md px-3 py-1.5">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {result.debug.responseTimeMs}ms
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowUp className="h-3 w-3" />
                    {result.debug.tokens.input} in
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowDown className="h-3 w-3" />
                    {result.debug.tokens.output} out
                  </span>
                  <span>{result.debug.model}</span>
                  <span>{result.debug.kbEntriesUsed} KB entries</span>
                </div>
              )}

              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">AI Response:</p>
                <p className="text-sm whitespace-pre-wrap">{result.response}</p>
              </div>

              {/* Debug: Prompt Builder */}
              {result.debug && result.debug.promptSections.length > 0 && (
                <div className="rounded-lg border border-dashed border-purple-300/50">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-purple-500/5 transition-colors"
                    onClick={() => setShowPrompt(!showPrompt)}
                  >
                    {showPrompt ? <ChevronDown className="h-3 w-3 text-purple-400" /> : <ChevronRight className="h-3 w-3 text-purple-400" />}
                    <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                      System Prompt ({result.debug.promptSections.length} sections, {result.debug.systemPrompt.length.toLocaleString()} chars)
                    </span>
                  </button>
                  {showPrompt && (
                    <div className="border-t border-purple-300/30 p-3">
                      <PromptBuilderView
                        sections={result.debug.promptSections}
                        fullPrompt={result.debug.systemPrompt}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
