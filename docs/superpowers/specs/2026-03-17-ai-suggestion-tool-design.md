# AI Suggestion Tool — Design Spec

**Date:** 2026-03-17
**Status:** Approved
**Approach:** Standalone suggestion module (no entanglement with auto-reply)

## Overview

A new AI-powered feature that lets human agents click a "magic star" button in the message input area to get AI-generated draft responses. The agent can either generate a response from scratch (empty input) or enhance existing text they've started typing (complete or rewrite modes). Responses stream in real-time with a stop button, and agents can regenerate for alternative suggestions.

## Architecture

```
[Star Button in MessageInput]
  -> POST /api/ai/suggest (streaming SSE endpoint)
  -> Server gathers context:
      - Conversation history (from chat_messages)
      - Agent KB entries (if attached to the channel's agent)
      - Contact memory (past session summaries)
      - Agent profile/personality (from channel_agent_settings -> ai_agents)
  -> Builds a suggestion-specific system prompt
  -> Calls Claude Sonnet (streaming)
  -> Streams tokens back to client via SSE
  -> Client renders tokens into the message input textarea
```

### Key Decisions

- **Standalone module** — completely independent from auto-reply (which is a static out-of-hours message, not AI). No shared prompt logic or services.
- **SSE for streaming** — lightweight, HTTP-based, no WebSocket setup needed. Client uses `fetch` + `ReadableStream` (not Axios, which doesn't support streaming SSE). Auth token must be manually attached to the fetch request headers from the same source the Axios instance uses.
- **New endpoint** `POST /api/ai/suggest` — follows existing route patterns, protected by `requireAuth`.
- **Ungated** — available to all plans. Can be wrapped with `PlanGate` later if needed.

## API Endpoint

### `POST /api/ai/suggest`

**Request body:**
```typescript
{
  sessionId: string;          // current conversation
  existingText?: string;      // what the agent has typed (empty = generate from scratch)
  mode: 'generate' | 'complete' | 'rewrite';
}
```

- `generate` — no existing text, AI writes a full response from scratch
- `complete` — AI continues from where the agent left off
- `rewrite` — AI uses the existing text as intent but writes a polished full response

**Response:** SSE stream
```
data: {"token": "Hi"}
data: {"token": " there"}
data: {"token": "!"}
data: {"done": true, "suggestionsToday": 14}
```

### Context Gathering (server-side)

All queries MUST filter by the authenticated user's `companyId` for multi-tenant isolation.

**Join path:** `sessionId` -> `chat_sessions.channel_id` -> `channel_agent_settings.agent_id` -> `ai_agents`

1. Fetch recent messages from `chat_messages` for this `sessionId` + `companyId` (last ~20 messages)
2. Look up the channel's agent via `chat_sessions.channel_id` -> `channel_agent_settings` -> `ai_agents`
3. If the agent has KB attachments, run hybrid search against the latest contact message to pull relevant KB chunks
4. Fetch contact info from `contacts` table (name, tags, custom fields), scoped by `companyId`
5. Fetch past session summaries for this contact (if any exist)

### Auth & Permissions

- Uses existing `requireAuth` middleware
- Permission resource: `'messages'` with action `'create'` (consistent with other message write operations)

### Rate Limiting

- Apply existing rate limiting middleware: 30 requests per minute per user
- This is separate from the soft usage counter — it prevents abuse at the API level

### Input Validation

- Validate request body with Zod (project convention per `PROJECT_SCOPE.md`)
- Schema: `sessionId` required string UUID, `mode` required enum, `existingText` optional string

### Usage Tracking

- Soft counter: in-memory `Map<userId, { count: number, date: string }>`, resets daily
- Count returned in the `done` event for the client to display
- Non-blocking, informational only — no hard limits
- Persistence can be added later if needed (not required for v1)

## Prompt Design

```
You are a helpful assistant drafting a WhatsApp reply on behalf of a human agent.

[Agent personality — from agent profile_data if available]
- Business: {business_name}, {business_type}
- Tone: {tone}, Length: {response_length}, Emoji: {emoji_usage}
- Custom instructions: {custom_instructions}

[Knowledge base context — if KB attached and relevant chunks found]
Use the following information to inform your response:
{kb_chunks}

[Contact context]
- Name: {contact_name}
- Tags: {tags}
- Past interaction summary: {session_summaries}

[Conversation history — last ~20 messages]
Contact: ...
Agent: ...
Contact: ...

[Mode-specific instruction]
- generate: "Write a complete reply to the contact's latest message."
- complete: "The agent has started typing: '{existingText}'. Continue naturally from where they left off. Do not repeat what they wrote."
- rewrite: "The agent drafted: '{existingText}'. Use this as direction for what they want to say, but write a polished, complete response from scratch."

[Guardrails]
- Write ONLY the message text. No greetings like "Dear Customer" unless it fits the tone.
- Do not include meta-commentary like "Here's a draft:" — just the message itself.
- Match the language the contact is using.
- Keep it natural for WhatsApp — not overly formal unless the agent profile says so.
```

**Model:** `claude-sonnet-4-20250514` (same as existing AI responses)
**Max tokens:** ~500 default, tunable based on `response_length` setting

## Frontend UI

### Star Button Placement

Inside `MessageInput.tsx`, next to the existing send button area. A small star/sparkle icon button.

### States

| State | UI |
|-------|-----|
| **Idle** | Star button visible, normal sparkle icon |
| **No text typed** | Click -> immediately starts generating (mode: `generate`) |
| **Text typed** | Click -> small dropdown appears: "Complete" / "Rewrite" |
| **Streaming** | Star button becomes a stop button (square icon). Tokens stream into the textarea |
| **Done** | Stop button reverts to star. A "Regenerate" button (circular arrow icon) appears next to it |
| **Regenerate** | Click -> clears AI-generated text only (preserves original typed text in `complete` mode), streams a new suggestion |

### Textarea Behavior During Streaming

- Textarea becomes read-only while streaming
- `complete` mode: existing text stays, new tokens append after it
- `generate` / `rewrite` mode: textarea clears and fills with streamed tokens
- After streaming completes, textarea becomes editable — agent can modify the draft before sending

### Usage Counter

Small subtle text below the input area: "12 suggestions used today". Only visible after the first suggestion of the day.

### Keyboard Shortcut

`Ctrl+J` (or similar) to trigger the star button. Generate mode if empty, show dropdown if text exists.

### New Files

- `client/src/components/inbox/AISuggestionButton.tsx` — star button + dropdown + stop/regenerate UI
- `client/src/hooks/useAISuggestion.ts` — SSE streaming, abort controller, state management

### Modified Files

- `client/src/components/inbox/MessageInput.tsx` — integrate `AISuggestionButton` component

## Streaming & State Management

### Client-side Hook (`useAISuggestion.ts`)

```typescript
interface UseAISuggestion {
  suggest: (sessionId: string, existingText: string, mode: 'generate' | 'complete' | 'rewrite') => void;
  stop: () => void;
  regenerate: () => void;
  streamedText: string;
  isStreaming: boolean;
  suggestionsToday: number;
  error: string | null;
}
```

**Flow:**
1. `suggest()` aborts any in-flight request first, then fires `fetch()` to `POST /api/ai/suggest` with streaming. Auth token is read from the same source as the Axios instance (e.g., Supabase session).
2. `ReadableStream` reader processes SSE chunks, appending tokens to `streamedText`
3. `AbortController` in a ref — `stop()` calls `controller.abort()`
4. `regenerate()` stores last request params and re-calls `suggest()` with same inputs. In `complete` mode, preserves the original `existingText` and only clears the AI-appended portion.
5. On `done: true`, updates `suggestionsToday` from response

### Server-side Streaming

- Express route sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Calls `anthropic.messages.create({ stream: true, ... })`
- Iterates `content_block_delta` events, writes each as SSE `data:` line
- On client disconnect (abort), cancels the Anthropic stream
- On completion, sends `data: {"done": true, "suggestionsToday": N}`

### Error Handling

- Network error -> toast: "Failed to generate suggestion, try again"
- Anthropic API error / rate limit -> toast with error message
- Client abort (stop button) -> clean disconnect, textarea keeps whatever was streamed so far

## Server Module Structure

### New Files

| File | Purpose |
|------|---------|
| `server/src/services/suggestion.ts` | Core logic — gathers context, builds prompt, calls Claude, streams response |
| `server/src/routes/ai.ts` (modified) | Add `/suggest` route to existing AI router — SSE setup, Zod validation, calls service |

### Service Responsibilities (`suggestion.ts`)

1. `gatherSuggestionContext(companyId, sessionId)` — fetches messages, agent profile, KB chunks, contact info
2. `buildSuggestionPrompt(context, existingText, mode)` — constructs system prompt + user message
3. `streamSuggestion(prompt, res)` — creates Anthropic streaming call, pipes tokens to SSE response

### Route Registration

- The `/suggest` route is added directly to the existing `server/src/routes/ai.ts` router (which is already mounted at `/api/ai` in `index.ts`). This avoids mounting two routers at the same prefix.
- Full path: `POST /api/ai/suggest`
- Protected by `requireAuth` middleware
- The route handler itself is thin — it validates input with Zod, sets SSE headers, and delegates to the suggestion service

### Dependencies (all already in the project)

- `@anthropic-ai/sdk` — Claude API calls
- Supabase client — DB queries
- No new npm packages needed

### What This Does NOT Touch

- `ai.ts` (existing AI auto-response logic) — completely separate
- `messageProcessor.ts` — no changes
- `promptBuilder.ts` — suggestion has its own prompt builder function

## Summary of All File Changes

### New Files (3)
- `client/src/components/inbox/AISuggestionButton.tsx`
- `client/src/hooks/useAISuggestion.ts`
- `server/src/services/suggestion.ts`

### Modified Files (2)
- `client/src/components/inbox/MessageInput.tsx` — integrate AISuggestionButton
- `server/src/routes/ai.ts` — add `/suggest` route to existing AI router

### Database Changes
None — no migrations needed for v1.
