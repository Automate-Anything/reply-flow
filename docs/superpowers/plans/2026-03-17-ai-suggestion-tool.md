# AI Suggestion Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a magic star button to the message input that generates AI draft responses for human agents, with streaming, stop, and regenerate capabilities.

**Architecture:** Standalone suggestion module — new service (`suggestion.ts`) handles context gathering, prompt building, and Claude streaming. Route added to existing `ai.ts` router. Client hook (`useAISuggestion.ts`) manages SSE streaming via `fetch` + `ReadableStream`. New `AISuggestionButton.tsx` component integrates into `MessageInput.tsx`.

**Tech Stack:** Anthropic SDK (streaming), Express SSE, Zod validation, React hooks, Supabase queries, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-17-ai-suggestion-tool-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/services/suggestion.ts` | Create | Context gathering, prompt building, Claude streaming |
| `server/src/routes/ai.ts` | Modify | Add `/suggest` SSE route with Zod validation |
| `server/src/middleware/rateLimit.ts` | Modify | Add `suggestionLimiter` |
| `client/src/hooks/useAISuggestion.ts` | Create | SSE streaming hook with abort, regenerate, usage counter |
| `client/src/components/inbox/AISuggestionButton.tsx` | Create | Star button UI with dropdown, stop, regenerate states |
| `client/src/components/inbox/MessageInput.tsx` | Modify | Integrate AISuggestionButton into button group |
| `client/src/components/inbox/MessageThread.tsx` | Modify | Pass `sessionId` prop to `MessageInput` |

---

## Task 1: Rate Limiter for Suggestions

**Files:**
- Modify: `server/src/middleware/rateLimit.ts:30-37`

- [ ] **Step 1: Add suggestion rate limiter**

Add a new rate limiter after the existing `sendLimiter` in `server/src/middleware/rateLimit.ts`:

```typescript
// AI suggestion: stricter limit since each call hits Anthropic API
export const suggestionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Suggestion rate limit reached. Please slow down.' },
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix server`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/middleware/rateLimit.ts
git commit -m "feat(suggestion): add rate limiter for AI suggestion endpoint"
```

---

## Task 2: Suggestion Service — Context Gathering

**Files:**
- Create: `server/src/services/suggestion.ts`

- [ ] **Step 1: Create the service file with types and context gathering**

Create `server/src/services/suggestion.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { searchKnowledgeBase } from './embeddings.js';

// ── Types ─────────────────────────────────────────────

export type SuggestionMode = 'generate' | 'complete' | 'rewrite';

interface SuggestionContext {
  messages: Array<{
    direction: string;
    sender_type: string;
    message_body: string;
    created_at: string;
  }>;
  agentProfile: {
    business_name?: string;
    business_type?: string;
    business_description?: string;
    response_flow?: {
      default_style?: {
        tone?: string;
        response_length?: string;
        emoji_usage?: string;
      };
    };
    custom_instructions?: string;
  } | null;
  kbChunks: string[];
  contact: {
    first_name?: string;
    whatsapp_name?: string;
    tags?: string[];
  } | null;
  sessionSummaries: string[];
}

// ── Usage Tracking (in-memory, resets daily) ──────────

const usageMap = new Map<string, { count: number; date: string }>();

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function incrementUsage(userId: string): number {
  const today = getToday();
  const entry = usageMap.get(userId);
  if (!entry || entry.date !== today) {
    usageMap.set(userId, { count: 1, date: today });
    return 1;
  }
  entry.count++;
  return entry.count;
}

export function getUsage(userId: string): number {
  const today = getToday();
  const entry = usageMap.get(userId);
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

// ── Context Gathering ─────────────────────────────────

export async function gatherSuggestionContext(
  companyId: string,
  sessionId: string,
): Promise<SuggestionContext> {
  // 1. Fetch session to get channel_id and contact_id
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, contact_id')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (!session) {
    throw new Error('Session not found');
  }

  // 2. Fetch recent messages (last 20)
  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('direction, sender_type, message_body, created_at')
    .eq('session_id', sessionId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  // 3. Look up channel agent settings -> agent profile
  let agentProfile: SuggestionContext['agentProfile'] = null;
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('agent_id, profile_data')
    .eq('channel_id', session.channel_id)
    .eq('company_id', companyId)
    .single();

  if (channelSettings?.agent_id) {
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('profile_data')
      .eq('id', channelSettings.agent_id)
      .eq('company_id', companyId)
      .single();
    if (agent) {
      agentProfile = agent.profile_data as SuggestionContext['agentProfile'];
    }
  } else if (channelSettings?.profile_data) {
    agentProfile = channelSettings.profile_data as SuggestionContext['agentProfile'];
  }

  // 4. Search KB if agent has KB attachments
  let kbChunks: string[] = [];
  const latestContactMessage = (messages ?? [])
    .filter((m) => m.direction === 'inbound')
    .at(0);

  if (latestContactMessage?.message_body && agentProfile?.response_flow) {
    const rf = agentProfile.response_flow as Record<string, unknown>;
    const fallbackKb = rf.fallback_kb_attachments as Array<{ kb_id: string }> | undefined;
    const kbMode = rf.agent_kb_mode as string | undefined;

    if (fallbackKb?.length && (kbMode === 'always' || !kbMode)) {
      try {
        const kbIds = fallbackKb.map((k) => k.kb_id);
        const results = await searchKnowledgeBase(
          companyId,
          latestContactMessage.message_body,
          { knowledgeBaseIds: kbIds },
        );
        kbChunks = results.map((r) => r.content);
      } catch {
        // KB search failure is non-fatal — proceed without KB context
      }
    }
  }

  // 5. Fetch contact info
  let contact: SuggestionContext['contact'] = null;
  if (session.contact_id) {
    const { data: contactData } = await supabaseAdmin
      .from('contacts')
      .select('first_name, whatsapp_name, tags')
      .eq('id', session.contact_id)
      .eq('company_id', companyId)
      .single();
    contact = contactData;
  }

  // 6. Fetch past session summaries for this contact
  let sessionSummaries: string[] = [];
  if (session.contact_id) {
    const { data: pastSessions } = await supabaseAdmin
      .from('chat_sessions')
      .select('summary')
      .eq('contact_id', session.contact_id)
      .eq('company_id', companyId)
      .neq('id', sessionId)
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);
    sessionSummaries = (pastSessions ?? [])
      .map((s) => s.summary as string)
      .filter(Boolean);
  }

  return {
    messages: (messages ?? []).reverse(), // chronological order
    agentProfile,
    kbChunks,
    contact,
    sessionSummaries,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix server`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/services/suggestion.ts
git commit -m "feat(suggestion): add context gathering service"
```

---

## Task 3: Suggestion Service — Prompt Builder & Streaming

**Files:**
- Modify: `server/src/services/suggestion.ts`

- [ ] **Step 1: Add prompt builder function**

Append to `server/src/services/suggestion.ts` after the `gatherSuggestionContext` function:

```typescript
// ── Prompt Builder ────────────────────────────────────

const RESPONSE_MODEL = 'claude-sonnet-4-20250514';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

function buildSuggestionPrompt(
  context: SuggestionContext,
  existingText: string | undefined,
  mode: SuggestionMode,
): { system: string; userMessage: string } {
  const parts: string[] = [];

  parts.push('You are a helpful assistant drafting a WhatsApp reply on behalf of a human agent.');

  // Agent personality
  if (context.agentProfile) {
    const p = context.agentProfile;
    const style = p.response_flow?.default_style;
    const personalityLines: string[] = [];
    if (p.business_name) personalityLines.push(`Business: ${p.business_name}`);
    if (p.business_type) personalityLines.push(`Type: ${p.business_type}`);
    if (style?.tone) personalityLines.push(`Tone: ${style.tone}`);
    if (style?.response_length) personalityLines.push(`Length: ${style.response_length}`);
    if (style?.emoji_usage) personalityLines.push(`Emoji usage: ${style.emoji_usage}`);
    if (personalityLines.length > 0) {
      parts.push('\n## Agent Profile\n' + personalityLines.join('\n'));
    }
    if (p.custom_instructions) {
      parts.push('\n## Custom Instructions\n' + p.custom_instructions);
    }
  }

  // KB context
  if (context.kbChunks.length > 0) {
    parts.push(
      '\n## Knowledge Base\nUse the following information to inform your response:\n' +
        context.kbChunks.join('\n\n'),
    );
  }

  // Contact context
  if (context.contact) {
    const c = context.contact;
    const name = c.first_name || c.whatsapp_name || 'Unknown';
    const contactLines = [`Name: ${name}`];
    if (c.tags?.length) contactLines.push(`Tags: ${c.tags.join(', ')}`);
    parts.push('\n## Contact\n' + contactLines.join('\n'));
  }

  // Session summaries
  if (context.sessionSummaries.length > 0) {
    parts.push(
      '\n## Past Interactions\n' +
        context.sessionSummaries.map((s, i) => `Session ${i + 1}: ${s}`).join('\n'),
    );
  }

  // Guardrails
  parts.push(`
## Rules
- Write ONLY the message text. No greetings like "Dear Customer" unless it fits the tone.
- Do not include meta-commentary like "Here's a draft:" — just the message itself.
- Match the language the contact is using.
- Keep it natural for WhatsApp — not overly formal unless the agent profile says so.`);

  const system = parts.join('\n');

  // Build conversation history as user message
  const historyLines = context.messages.map((m) => {
    const label = m.direction === 'inbound' ? 'Contact' : 'Agent';
    return `${label}: ${m.message_body || '[media]'}`;
  });

  let userMessage = '## Conversation\n' + historyLines.join('\n') + '\n\n';

  // Mode-specific instruction
  switch (mode) {
    case 'generate':
      userMessage += 'Write a complete reply to the contact\'s latest message.';
      break;
    case 'complete':
      userMessage += `The agent has started typing: "${existingText}". Continue naturally from where they left off. Do not repeat what they wrote. Output ONLY the continuation text.`;
      break;
    case 'rewrite':
      userMessage += `The agent drafted: "${existingText}". Use this as direction for what they want to say, but write a polished, complete response from scratch.`;
      break;
  }

  return { system, userMessage };
}
```

- [ ] **Step 2: Add streaming function**

Append to `server/src/services/suggestion.ts`:

```typescript
// ── Streaming ─────────────────────────────────────────

export async function streamSuggestion(
  companyId: string,
  sessionId: string,
  userId: string,
  existingText: string | undefined,
  mode: SuggestionMode,
  res: Response,
): Promise<void> {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!anthropic) {
    res.write(`data: ${JSON.stringify({ error: 'AI suggestions are not configured (missing API key)' })}\n\n`);
    res.end();
    return;
  }

  try {
    const context = await gatherSuggestionContext(companyId, sessionId);
    const { system, userMessage } = buildSuggestionPrompt(context, existingText, mode);

    // Determine max tokens based on response length setting
    const responseLength = context.agentProfile?.response_flow?.default_style?.response_length;
    let maxTokens = 500;
    if (responseLength === 'concise') maxTokens = 250;
    if (responseLength === 'detailed') maxTokens = 800;

    const stream = anthropic.messages.stream({
      model: RESPONSE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Handle client disconnect
    const onClose = () => {
      stream.abort();
    };
    res.on('close', onClose);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
      }
    }

    // Increment usage counter
    const suggestionsToday = incrementUsage(userId);

    // Send done event
    res.write(`data: ${JSON.stringify({ done: true, suggestionsToday })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate suggestion';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build --prefix server`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/services/suggestion.ts
git commit -m "feat(suggestion): add prompt builder and streaming"
```

---

## Task 4: Route — Add `/suggest` to AI Router

**Files:**
- Modify: `server/src/routes/ai.ts`

- [ ] **Step 1: Add Zod schema and imports at the top of `ai.ts`**

Add these imports near the top of `server/src/routes/ai.ts` (after existing imports):

```typescript
import { streamSuggestion } from '../services/suggestion.js';
import { suggestionLimiter } from '../middleware/rateLimit.js';
```

Add the Zod schema near the other Zod schemas in the file (or after imports if none exist):

```typescript
import { z } from 'zod';

const suggestSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['generate', 'complete', 'rewrite']),
  existingText: z.string().optional(),
});
```

Note: Check if `z` / `zod` is already imported in the file. If so, only add the schema.

- [ ] **Step 2: Add the route handler**

Add the route at an appropriate location in `server/src/routes/ai.ts` (e.g., after the existing routes, before `export default router`):

```typescript
// ── AI Suggestion (streaming SSE) ─────────────────────

router.post(
  '/suggest',
  requireAuth,
  requirePermission('messages', 'create'),
  suggestionLimiter,
  async (req, res) => {
    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const { sessionId, mode, existingText } = parsed.data;

    await streamSuggestion(
      req.companyId!,
      sessionId,
      req.userId!,
      existingText,
      mode,
      res,
    );
  },
);
```

- [ ] **Step 3: Verify build**

Run: `npm run build --prefix server`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/ai.ts
git commit -m "feat(suggestion): add /suggest SSE route to AI router"
```

---

## Task 5: Client Hook — `useAISuggestion`

**Files:**
- Create: `client/src/hooks/useAISuggestion.ts`

- [ ] **Step 1: Create the streaming hook**

Create `client/src/hooks/useAISuggestion.ts`:

```typescript
import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

type SuggestionMode = 'generate' | 'complete' | 'rewrite';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface LastRequest {
  sessionId: string;
  existingText: string;
  mode: SuggestionMode;
}

export function useAISuggestion() {
  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [suggestionsToday, setSuggestionsToday] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<LastRequest | null>(null);

  const suggest = useCallback(
    async (sessionId: string, existingText: string, mode: SuggestionMode) => {
      // Abort any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      // Store for regenerate
      lastRequestRef.current = { sessionId, existingText, mode };

      setIsStreaming(true);
      setError(null);
      setStreamedText('');

      try {
        // Get auth token from Supabase (same source as Axios interceptor in api.ts)
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch(`${API_URL}/api/ai/suggest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId, mode, existingText: existingText || undefined }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed (${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            if (!jsonStr) continue;

            try {
              const data = JSON.parse(jsonStr);

              if (data.token) {
                setStreamedText((prev) => prev + data.token);
              }

              if (data.done) {
                setSuggestionsToday(data.suggestionsToday ?? 0);
              }

              if (data.error) {
                setError(data.error);
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User stopped — not an error, keep whatever was streamed
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to generate suggestion');
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const regenerate = useCallback(() => {
    const last = lastRequestRef.current;
    if (!last) return;
    suggest(last.sessionId, last.existingText, last.mode);
  }, [suggest]);

  return {
    suggest,
    stop,
    regenerate,
    streamedText,
    setStreamedText,
    isStreaming,
    suggestionsToday,
    error,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix client`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useAISuggestion.ts
git commit -m "feat(suggestion): add useAISuggestion streaming hook"
```

---

## Task 6: AISuggestionButton Component

**Files:**
- Create: `client/src/components/inbox/AISuggestionButton.tsx`

- [ ] **Step 1: Create the button component**

Create `client/src/components/inbox/AISuggestionButton.tsx`:

```tsx
import { Sparkles, Square, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SuggestionMode = 'generate' | 'complete' | 'rewrite';

interface AISuggestionButtonProps {
  hasText: boolean;
  isStreaming: boolean;
  hasStreamedText: boolean;
  onSuggest: (mode: SuggestionMode) => void;
  onStop: () => void;
  onRegenerate: () => void;
  disabled?: boolean;
}

export function AISuggestionButton({
  hasText,
  isStreaming,
  hasStreamedText,
  onSuggest,
  onStop,
  onRegenerate,
  disabled,
}: AISuggestionButtonProps) {
  // Streaming state — show stop button
  if (isStreaming) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-red-500 hover:text-red-600"
            onClick={onStop}
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop generating</TooltipContent>
      </Tooltip>
    );
  }

  // After streaming — show regenerate button alongside the star
  const regenerateButton = hasStreamedText && !isStreaming ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={onRegenerate}
          disabled={disabled}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Regenerate suggestion</TooltipContent>
    </Tooltip>
  ) : null;

  // No text — click directly generates
  if (!hasText) {
    return (
      <>
        {regenerateButton}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-purple-500"
              onClick={() => onSuggest('generate')}
              disabled={disabled}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Generate AI suggestion</TooltipContent>
        </Tooltip>
      </>
    );
  }

  // Has text — show dropdown with Complete / Rewrite
  // Note: No Tooltip wrapper here — nesting Tooltip inside DropdownMenuTrigger
  // causes Radix UI event handler conflicts. The dropdown itself is self-explanatory.
  return (
    <>
      {regenerateButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-purple-500"
            disabled={disabled}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onSuggest('complete')}>
            Complete — continue from here
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSuggest('rewrite')}>
            Rewrite — polish my draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix client`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/AISuggestionButton.tsx
git commit -m "feat(suggestion): add AISuggestionButton component"
```

---

## Task 7: Integrate into MessageInput

**Files:**
- Modify: `client/src/components/inbox/MessageInput.tsx`
- Modify: `client/src/components/inbox/MessageThread.tsx:199-208`

This is the most delicate task — `MessageInput.tsx` is a 626-line component with complex state. The integration points are:

1. Import the hook and component
2. Wire up the hook to the textarea state
3. Place the button in the button group
4. Handle textarea read-only during streaming
5. Show usage counter

- [ ] **Step 1: Add imports**

Add at the top of `MessageInput.tsx` (near existing imports):

```typescript
import { useAISuggestion } from '@/hooks/useAISuggestion';
import { AISuggestionButton } from './AISuggestionButton';
```

- [ ] **Step 2: Wire up the hook inside the component**

Inside the `MessageInput` component function, after the existing state declarations, add:

```typescript
const {
  suggest,
  stop: stopSuggestion,
  regenerate,
  streamedText,
  setStreamedText,
  isStreaming: isSuggestionStreaming,
  suggestionsToday,
  error: suggestionError,
} = useAISuggestion();
```

Add a ref to track original text for complete mode:

```typescript
const originalTextRef = useRef<string>('');
```

Add a handler function:

```typescript
const handleSuggest = useCallback(
  (mode: 'generate' | 'complete' | 'rewrite') => {
    if (!sessionId) return;
    originalTextRef.current = mode === 'complete' ? text : '';
    suggest(sessionId, text, mode);
  },
  [sessionId, text, suggest],
);
```

**Important:** `sessionId` is NOT currently a prop of `MessageInput`. You must:

1. Add it to `MessageInputProps`:
```typescript
interface MessageInputProps {
  // ... existing props
  sessionId?: string;  // Add this for AI suggestion
}
```

2. Modify `MessageThread.tsx` (line 199-208) to pass it:
```tsx
<MessageInput
  key={sessionId}
  sessionId={sessionId}  // Add this line
  onSend={onSend}
  onSendVoiceNote={onSendVoiceNote}
  onSchedule={onSchedule}
  initialDraft={initialDraft}
  onDraftChange={onDraftChange}
  replyingTo={replyingTo}
  onCancelReply={onCancelReply}
/>
```

- [ ] **Step 3: Sync streamed text to textarea**

Add an effect to sync the streamed text into the textarea state:

```typescript
useEffect(() => {
  if (!isSuggestionStreaming && !streamedText) return;

  if (originalTextRef.current) {
    // Complete mode — prepend original text
    setText(originalTextRef.current + streamedText);
  } else {
    setText(streamedText);
  }
}, [streamedText, isSuggestionStreaming]);
```

Note: `setText` is called directly (not through textarea onChange), so `onDraftChange` won't fire during streaming — this is intentional since we don't want to save a partial AI draft.

- [ ] **Step 4: Show suggestion error as toast**

Add an effect for errors:

```typescript
useEffect(() => {
  if (suggestionError) {
    toast.error(suggestionError);
  }
}, [suggestionError]);
```

Check if `toast` is already imported (likely from `sonner` based on the project). If not, add the import.

- [ ] **Step 5: Place the button in the button group**

Find the button group area in the JSX (around line 414-437). The Send/VoiceRecord buttons are inside a ternary (`hasText ? <Send> : <VoiceRecord>`). Place the `AISuggestionButton` **before** this ternary as a sibling — it should always be visible regardless of whether text exists:

```tsx
<AISuggestionButton
  hasText={text.trim().length > 0}
  isStreaming={isSuggestionStreaming}
  hasStreamedText={streamedText.length > 0}
  onSuggest={handleSuggest}
  onStop={stopSuggestion}
  onRegenerate={regenerate}
  disabled={disabled}
/>
```

- [ ] **Step 6: Make textarea read-only during streaming**

Find the `<textarea>` or `<Textarea>` element and add:

```tsx
readOnly={isSuggestionStreaming}
```

- [ ] **Step 7: Add usage counter below input**

After the textarea/input area, add a subtle usage counter:

```tsx
{suggestionsToday > 0 && (
  <p className="text-xs text-muted-foreground px-3 pb-1">
    {suggestionsToday} suggestion{suggestionsToday !== 1 ? 's' : ''} used today
  </p>
)}
```

- [ ] **Step 8: Verify build**

Run: `npm run build --prefix client`
Expected: No errors

- [ ] **Step 9: Manual testing checklist**

Run: `npm run dev`

Test these scenarios:
1. Empty textarea -> click star -> should start streaming a full response
2. Type some text -> click star -> dropdown with "Complete" / "Rewrite" appears
3. Pick "Complete" -> AI continues from typed text
4. Pick "Rewrite" -> textarea clears, AI writes fresh response
5. Click stop during streaming -> streaming stops, partial text stays
6. Click regenerate -> new suggestion streams in
7. After streaming, textarea is editable — can modify and send normally
8. Usage counter shows and increments
9. Rapid clicking doesn't cause multiple concurrent streams

- [ ] **Step 10: Commit**

```bash
git add client/src/components/inbox/MessageInput.tsx client/src/components/inbox/MessageThread.tsx
git commit -m "feat(suggestion): integrate AI suggestion button into MessageInput"
```

---

## Task 8: Keyboard Shortcut

**Files:**
- Modify: `client/src/components/inbox/MessageInput.tsx`

- [ ] **Step 1: Add keyboard shortcut handler**

In `MessageInput.tsx`, find the existing `onKeyDown` handler for the textarea (which handles Enter to send). Add a handler for `Ctrl+J`:

```typescript
// Inside the existing onKeyDown or as a new handler
if (e.ctrlKey && e.key === 'j') {
  e.preventDefault();
  if (text.trim().length === 0) {
    handleSuggest('generate');
  }
  // If text exists, we can't show dropdown from keyboard — default to 'complete'
  else {
    handleSuggest('complete');
  }
}
```

Note: When triggered via keyboard with existing text, it defaults to 'complete' mode since we can't show a dropdown from a keyboard shortcut. This is a reasonable default — users who want 'rewrite' can click the button.

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix client`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/MessageInput.tsx
git commit -m "feat(suggestion): add Ctrl+J keyboard shortcut for AI suggestion"
```

---

## Task 9: Final Integration Test & Cleanup

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Both client and server build with no errors

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit --project client/tsconfig.json && npx tsc --noEmit --project server/tsconfig.json`
Expected: No type errors

- [ ] **Step 3: End-to-end manual test**

Run: `npm run dev`

Full test flow:
1. Open a conversation with message history
2. Click the star button with empty input -> full response streams in
3. Edit the response -> send it -> message sends normally
4. Type partial text -> click star -> pick "Complete" -> AI continues
5. Type text -> click star -> pick "Rewrite" -> AI rewrites from scratch
6. During streaming, click stop -> partial text stays, editable
7. After suggestion, click regenerate -> new suggestion appears
8. In complete mode, regenerate preserves original typed text
9. Counter shows "X suggestions used today"
10. Open a different conversation -> suggestion works with that conversation's context
11. If no agent is attached to the channel -> suggestion still works (just no personality/KB context)

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat(suggestion): final cleanup and integration"
```
