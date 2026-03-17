# Agent-Level Knowledge Base & Layout Redesign

**Date:** 2026-03-16
**Status:** Approved

## Problem

1. The AI agent settings page uses a flat 4-tab layout (Response Flow, Communication Style, Language Preferences, Fallback Behavior) with no implied setup order. New users don't know where to start.
2. Knowledge bases can only be attached at the scenario level. There's no way to attach a "general" KB that applies across all messages (or as a fallback when no scenario matches). The `fallback_kb_attachments` field exists in the data model but has no UI.

## Solution

### 1. Restructure AI Agent Page Layout

Replace the 4-tab layout in `AIAgentSections` with 3 tabs. The first tab uses numbered, collapsible accordion steps to establish a setup order.

**Tab 1: "Defaults"**
- Step 1: Communication Style — existing `StyleFields` + `StylePreview`
- Step 2: Knowledge Base — new agent-level KB picker + apply mode toggle
- Step 3: Language Preferences — existing `LanguageSection`

**Tab 2: "Response Flow"**
- Scenarios list — existing `ResponseFlowSection`, no accordion wrapper needed

**Tab 3: "Fallback Behavior"**
- Fallback mode + style — existing `FallbackToggle`, no accordion wrapper needed

Each accordion step uses the existing `SectionCard` pattern (already used by `LanguageSection`) — collapsible, with a step number, title, and brief summary when collapsed. Clicking expands to show the full editor.

**Collapsed summaries:**
- Step 1 (Communication Style): e.g., "Professional tone, moderate length, minimal emoji" (reuse `formatStyleBrief` logic client-side)
- Step 2 (Knowledge Base): e.g., "3 knowledge bases attached (fallback only)"
- Step 3 (Language): e.g., "Match customer language" (already implemented in `LanguageSection`)

**Save model:** Each accordion step has its own independent save. `LanguageSection` already works this way via `SectionCard`. Steps 1 and 2 need the same pattern — each step manages its own draft state, with inline Save/Cancel buttons that appear when dirty. This replaces the current shared `saveFooter` that the Defaults tab's style fields use today.

### 2. Agent-Level Knowledge Base (Step 2 in Defaults)

**UI elements:**

1. **KBPicker** — the existing reusable component from `KBPicker.tsx`. Users attach one or more KBs, each with optional per-KB instructions.

2. **Apply mode toggle** — a switch below the KB picker:
   - Label: "Include in all messages"
   - Helper text (off): "Knowledge base will only be used when no scenario matches"
   - Helper text (on): "Knowledge base will be included alongside scenario-specific knowledge in every response"
   - Default: off (fallback only)

3. **Collapsed summary** — shows "3 knowledge bases attached (fallback only)" or "2 knowledge bases attached (always included)".

**Data model:**

Add one new field to the `ResponseFlow` interface. Reuse the existing `fallback_kb_attachments` field for storage.

```typescript
interface ResponseFlow {
  // ... existing fields
  fallback_kb_attachments?: ScenarioKBAttachment[]; // existing type alias for { kb_id: string; instructions?: string }
  agent_kb_mode?: 'always' | 'fallback'; // NEW — defaults to 'fallback'
}
```

The existing `ScenarioKBAttachment` type (aliased as `KBAttachment`) is reused — no new types needed.

No database migration needed — both fields live inside the `profile_data` JSONB column.

### 3. Prompt Builder Changes

**File:** `server/src/services/promptBuilder.ts`

**Server-side type:** Add `agent_kb_mode` to the server's `ResponseFlow` interface (line 50) to match the client type.

**Function changes:**

- **`buildScenarioResponsePrompt`** (scenario matched): When `agent_kb_mode === 'always'`, include agent-level KB entries **before** the active scenario block. Label them distinctly:
  ```
  ## General Knowledge Base
  [agent-level KB entries]

  ## Scenario Knowledge Base
  [scenario-specific KB entries]
  ```
  General KB comes first so the LLM treats it as background context, with scenario-specific KB taking priority by appearing closer to the instructions.

- **`buildScenarioResponsePrompt`** (fallback branch, no match): Already includes `fallback_kb_attachments` regardless of mode. No change needed.

- **`buildResponseFlowPrompt`** (full prompt / preview): Already includes `fallback_kb_attachments`. No change needed — this path is used for prompt preview and doesn't do classification.

- **Legacy `buildLegacyPrompt`**: No change. Legacy path doesn't use response flows.

When `agent_kb_mode` is `'fallback'` or undefined, current behavior is preserved — agent-level KB entries only appear when no scenario matches.

## Files Changed

| File | Change |
|------|--------|
| `client/src/components/settings/AIAgentSections.tsx` | Replace 4-tab layout with 3 tabs + accordion steps in Defaults |
| `client/src/hooks/useCompanyAI.ts` | Add `agent_kb_mode` to `ResponseFlow` type |
| `client/src/components/settings/response-flow/useResponseFlow.ts` | Remove shared dirty/saveFooter dependency for style fields. Step 2 (KB) manages its own local draft state following the LanguageSection pattern, saving directly via saveProfileFields. |
| `server/src/services/promptBuilder.ts` | Add `agent_kb_mode` to server-side `ResponseFlow` type; include agent-level KB in scenario response prompts when mode is `'always'` |

## Files NOT Changed

- No new database migration (JSONB field)
- No new API endpoints (existing save flow handles it)
- `KBPicker.tsx` — reused as-is
- `StyleFields`, `StylePreview`, `LanguageSection`, `ResponseFlowSection`, `FallbackToggle` — reused as-is, just re-parented

## Edge Cases

- **No KBs attached + toggle set to always:** No-op, same as having no agent-level KB
- **Agent-level KB overlaps with scenario KB:** Both included; duplicates possible. Token cost increases but no incorrect behavior. Deduplication is a potential future optimization if KB sizes warrant it.
- **Existing agents with no `agent_kb_mode`:** Defaults to `'fallback'`, preserving current behavior
- **Prompt preview panel:** Stays in the Response Flow tab (unchanged). It already renders the full prompt including agent-level KB when present.
