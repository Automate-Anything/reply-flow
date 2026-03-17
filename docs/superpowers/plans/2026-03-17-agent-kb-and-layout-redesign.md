# Agent-Level KB & Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the AI agent settings page from 4 tabs to 3 tabs with accordion steps, and add an agent-level knowledge base picker with always/fallback apply modes.

**Architecture:** The 4-tab layout in `AIAgentSections` becomes 3 tabs (Defaults, Response Flow, Fallback). The Defaults tab contains 3 collapsible `SectionCard` steps: Communication Style, Knowledge Base, and Language. Each step manages its own draft state and saves independently. The prompt builder gains a conditional branch to include agent-level KB entries in scenario prompts when `agent_kb_mode === 'always'`.

**Tech Stack:** React, TypeScript, Tailwind CSS, ShadCN UI components, Express server

**Spec:** `docs/superpowers/specs/2026-03-16-agent-kb-and-layout-redesign.md`

---

## Chunk 1: Data Model & Type Changes

### Task 1: Add `agent_kb_mode` to client-side `ResponseFlow` type

**Files:**
- Modify: `client/src/hooks/useCompanyAI.ts:62-69`

- [ ] **Step 1: Add `agent_kb_mode` field to `ResponseFlow` interface**

In `client/src/hooks/useCompanyAI.ts`, add the new field to the `ResponseFlow` interface at line 68 (after `fallback_kb_attachments`):

```typescript
export interface ResponseFlow {
  default_style: CommunicationStyle;
  scenarios: Scenario[];
  fallback_mode: FallbackMode;
  fallback_style?: CommunicationStyle;
  human_phone?: string;
  fallback_kb_attachments?: ScenarioKBAttachment[];
  agent_kb_mode?: 'always' | 'fallback';
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useCompanyAI.ts
git commit -m "feat: add agent_kb_mode to client ResponseFlow type"
```

### Task 2: Add `agent_kb_mode` to server-side `ResponseFlow` type

**Files:**
- Modify: `server/src/services/promptBuilder.ts:50-57`

- [ ] **Step 1: Add `agent_kb_mode` field to server `ResponseFlow` interface**

In `server/src/services/promptBuilder.ts`, add the field at line 56 (after `fallback_kb_attachments`):

```typescript
export interface ResponseFlow {
  default_style: CommunicationStyle;
  scenarios: Scenario[];
  fallback_mode: FallbackMode;
  fallback_style?: CommunicationStyle;
  human_phone?: string;
  fallback_kb_attachments?: { kb_id: string; instructions?: string }[];
  agent_kb_mode?: 'always' | 'fallback';
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/promptBuilder.ts
git commit -m "feat: add agent_kb_mode to server ResponseFlow type"
```

---

### Task 2b: Add prop-sync effect to `useResponseFlow` hook

**Files:**
- Modify: `client/src/components/settings/response-flow/useResponseFlow.ts:57-62`

When `StyleSection` or `AgentKBSection` save independently (bypassing the hook), the parent's `profileData` prop updates but the hook's internal `flow` state stays stale. Add a `useEffect` that resyncs `flow` from `profileData` when the prop changes and the hook isn't dirty.

- [ ] **Step 1: Add sync effect after the `useState` initialization**

After line 62 (`const [dirty, setDirty] = useState(false);`), add:

```typescript
  // Resync flow from profileData when it changes externally (e.g., independent section saves)
  useEffect(() => {
    if (!dirty) {
      const raw = profileData.response_flow ?? migrateFromFlat(profileData);
      setFlow(migrateFlow(raw));
    }
  }, [profileData, dirty]);
```

This requires adding `useEffect` to the import on line 1:

```typescript
import { useState, useCallback, useEffect } from 'react';
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/response-flow/useResponseFlow.ts
git commit -m "fix: sync useResponseFlow state when profileData changes externally"
```

---

## Chunk 2: Prompt Builder — Agent-Level KB in Scenario Responses

### Task 3: Include agent-level KB in `buildScenarioResponsePrompt` when mode is `always`

**Files:**
- Modify: `server/src/services/promptBuilder.ts:541-587` (the matched-scenario branch of `buildScenarioResponsePrompt`)

The change goes inside the `if (matchedScenario)` branch (line 541), **after** the style section (line 549) and **before** the scenario block (line 552). When `agent_kb_mode === 'always'` and `fallback_kb_attachments` has entries, inject a "General Knowledge Base" section.

- [ ] **Step 1: Add agent-level KB injection in the matched-scenario branch**

After line 549 (`if (styleDesc) track('CommunicationStyle', ...)`) and before line 552 (`const scenarioLines: string[] = [];`), add:

```typescript
    // Agent-level KB (when mode is 'always', include alongside scenario KB)
    if (flow.agent_kb_mode === 'always' && flow.fallback_kb_attachments && flow.fallback_kb_attachments.length > 0) {
      const agentKBEntries: KBEntry[] = [];
      for (const att of flow.fallback_kb_attachments) {
        agentKBEntries.push(...kbEntries.filter((e) => e.knowledge_base_id === att.kb_id));
      }
      if (agentKBEntries.length > 0) {
        const agentKB = buildKBSection(agentKBEntries, t);
        if (agentKB) track('AgentKB', agentKB.replace('## Relevant Knowledge Base Context', '## General Knowledge Base'));
      }
    }
```

This inserts the General KB section **before** the Active Scenario block, so the LLM treats it as background context with scenario-specific info taking positional priority.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Manual verification**

Use the debug mode prompt preview (in the Response Flow tab) to confirm:
- With `agent_kb_mode: 'always'` — the General Knowledge Base section appears before the Active Scenario section.
- With `agent_kb_mode: 'fallback'` or undefined — no change to current behavior.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/promptBuilder.ts
git commit -m "feat: include agent-level KB in scenario prompts when mode is always"
```

---

## Chunk 3: Communication Style Section Card

### Task 4: Create `StyleSection` component wrapping `StyleFields` + `StylePreview` in a `SectionCard`

This task extracts the style editing from the current shared-save tab into its own independent `SectionCard` step, following the `LanguageSection` pattern.

**Files:**
- Create: `client/src/components/settings/sections/StyleSection.tsx`

- [ ] **Step 1: Create `StyleSection.tsx`**

This component follows the exact same pattern as `LanguageSection.tsx` (lines 1-91): local draft state, `SectionCard` wrapper, independent save.

```typescript
import { useState } from 'react';
import { Palette } from 'lucide-react';
import type { CommunicationStyle } from '@/hooks/useCompanyAI';
import StyleFields from '../response-flow/StyleFields';
import StylePreview from '../response-flow/StylePreview';
import SectionCard from './SectionCard';
import { TONE_OPTIONS, LENGTH_OPTIONS, EMOJI_OPTIONS } from '../response-flow/StyleFields';

interface Props {
  style: CommunicationStyle;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (style: CommunicationStyle) => Promise<void>;
}

function formatStyleBrief(style: CommunicationStyle): string {
  const parts: string[] = [];
  const tone = TONE_OPTIONS.find((o) => o.value === style.tone);
  if (tone) parts.push(`${tone.label} tone`);
  const len = LENGTH_OPTIONS.find((o) => o.value === style.response_length);
  if (len) parts.push(`${len.label.toLowerCase()} length`);
  const emoji = EMOJI_OPTIONS.find((o) => o.value === style.emoji_usage);
  if (emoji) parts.push(`${emoji.label.toLowerCase()} emoji`);
  return parts.join(', ') || 'Not configured';
}

export default function StyleSection({ style, isExpanded, onToggle, onSave }: Props) {
  const [draft, setDraft] = useState<CommunicationStyle>(style);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onToggle();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft(style);
    onToggle();
  };

  const isConfigured = !!(style.tone || style.response_length || style.emoji_usage);

  return (
    <SectionCard
      icon={<Palette className="h-4 w-4" />}
      title="Communication Style"
      isConfigured={isConfigured}
      summary={formatStyleBrief(style)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Set the default tone and style for your AI agent. Scenarios can override these individually.
        </p>
        <StyleFields style={draft} onChange={setDraft} />
        <StylePreview style={draft} />
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build. The component isn't used yet, but should compile without errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/sections/StyleSection.tsx
git commit -m "feat: create StyleSection component with independent save"
```

---

## Chunk 4: Agent-Level KB Section Card

### Task 5: Create `AgentKBSection` component

This is the new component for Step 2 in the Defaults tab. It wraps `KBPicker` in a `SectionCard` with an apply-mode toggle.

**Files:**
- Create: `client/src/components/settings/sections/AgentKBSection.tsx`

- [ ] **Step 1: Create `AgentKBSection.tsx`**

```typescript
import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import type { KnowledgeBase } from '@/hooks/useCompanyKB';
import KBPicker from '../KBPicker';
import SectionCard from './SectionCard';

interface Props {
  kbAttachments: ScenarioKBAttachment[];
  agentKBMode: 'always' | 'fallback';
  knowledgeBases: KnowledgeBase[];
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (kbAttachments: ScenarioKBAttachment[], mode: 'always' | 'fallback') => Promise<void>;
}

function formatKBSummary(count: number, mode: 'always' | 'fallback'): string {
  if (count === 0) return 'No knowledge bases attached';
  const modeLabel = mode === 'always' ? 'always included' : 'fallback only';
  return `${count} knowledge base${count !== 1 ? 's' : ''} attached (${modeLabel})`;
}

export default function AgentKBSection({
  kbAttachments,
  agentKBMode,
  knowledgeBases,
  isExpanded,
  onToggle,
  onSave,
}: Props) {
  const [draftAttachments, setDraftAttachments] = useState<ScenarioKBAttachment[]>(kbAttachments);
  const [draftMode, setDraftMode] = useState<'always' | 'fallback'>(agentKBMode);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draftAttachments, draftMode);
      onToggle();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraftAttachments(kbAttachments);
    setDraftMode(agentKBMode);
    onToggle();
  };

  const isConfigured = kbAttachments.length > 0;

  return (
    <SectionCard
      icon={<BookOpen className="h-4 w-4" />}
      title="Knowledge Base"
      isConfigured={isConfigured}
      summary={formatKBSummary(kbAttachments.length, agentKBMode)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Attach knowledge bases for your AI agent to reference across conversations.
        </p>

        <KBPicker
          value={draftAttachments}
          onChange={setDraftAttachments}
          knowledgeBases={knowledgeBases}
          createHref="/knowledge-base"
        />

        {draftAttachments.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="agent-kb-mode" className="text-xs font-medium">
                Include in all messages
              </Label>
              <p className="text-xs text-muted-foreground">
                {draftMode === 'always'
                  ? 'Knowledge base will be included alongside scenario-specific knowledge in every response'
                  : 'Knowledge base will only be used when no scenario matches'}
              </p>
            </div>
            <Switch
              id="agent-kb-mode"
              checked={draftMode === 'always'}
              onCheckedChange={(checked) => setDraftMode(checked ? 'always' : 'fallback')}
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build. Component compiles but isn't wired up yet.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/sections/AgentKBSection.tsx
git commit -m "feat: create AgentKBSection component with KB picker and apply mode toggle"
```

---

## Chunk 5: Rewire AIAgentSections — 3 Tabs with Accordion Steps

### Task 6: Rewrite `AIAgentSections` to use 3-tab layout with SectionCard steps

This is the main integration task. Replace the 4-tab layout with 3 tabs. The "Defaults" tab renders 3 `SectionCard` steps (StyleSection, AgentKBSection, LanguageSection). The "Response Flow" and "Fallback" tabs stay largely the same but the Fallback tab now needs its own save logic (it previously shared `saveFooter` with style).

**Files:**
- Modify: `client/src/components/settings/AIAgentSections.tsx` (full rewrite of the component body)

**Important context for the implementer:**

- `useResponseFlow` hook (at `client/src/components/settings/response-flow/useResponseFlow.ts`) manages shared flow state including `dirty`, `updateDefaultStyle`, `setFallbackMode`, `setFallbackStyle`, `reset`, `clearDirty`.
- Currently, `dirty`/`saveFooter` is shared between the Style tab and the Fallback tab. After this change:
  - **Style** gets its own save via `StyleSection` (saves `default_style` to `response_flow`).
  - **Fallback** keeps using `useResponseFlow` for `dirty`/`saveFooter` (it still modifies `fallback_mode` and `fallback_style` which need the shared flow state).
  - **KB** gets its own save via `AgentKBSection` (saves `fallback_kb_attachments` and `agent_kb_mode` to `response_flow`).
- The `ResponseFlowSection` (scenarios) uses `onAutoSave` and manages its own saves — no change needed.

- [ ] **Step 1: Rewrite `AIAgentSections.tsx`**

Replace the full file content with:

```typescript
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { PlanGate } from '@/components/auth/PlanGate';
import type { ProfileData, CommunicationStyle, ScenarioKBAttachment } from '@/hooks/useCompanyAI';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import { useDebugMode } from '@/hooks/useDebugMode';
import ResponseFlowSection from './response-flow/ResponseFlowSection';
import FallbackToggle from './response-flow/FallbackToggle';
import StyleSection from './sections/StyleSection';
import AgentKBSection from './sections/AgentKBSection';
import LanguageSection from './sections/LanguageSection';
import { useResponseFlow } from './response-flow/useResponseFlow';
import PromptPreviewPanel from './PromptPreviewPanel';

interface Props {
  profileData: ProfileData;
  onSave: (updates: { profile_data: ProfileData }) => Promise<unknown>;
  agentId?: string;
}

export default function AIAgentSections({ profileData, onSave, agentId }: Props) {
  const { knowledgeBases } = useCompanyKB();
  const { debugMode } = useDebugMode();

  // Response flow state (used by Response Flow tab, Fallback tab, and as source of truth for defaults)
  const {
    flow, dirty,
    addScenario, updateScenario, removeScenario,
    setFallbackMode, setFallbackStyle, reset, clearDirty,
  } = useResponseFlow(profileData);

  useFormDirtyGuard(dirty);

  // ── Save helpers ──

  /** Save arbitrary profile fields (used by LanguageSection) */
  const saveProfileFields = useCallback(
    async (fields: Partial<ProfileData>) => {
      const merged = { ...profileData, ...fields };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, onSave]
  );

  /** Save communication style to response_flow.default_style.
   *  Reads base flow from profileData (not the hook's flow) to avoid
   *  accidentally persisting unsaved changes from other tabs. */
  const saveStyle = useCallback(
    async (style: CommunicationStyle) => {
      const baseFlow = profileData.response_flow ?? flow;
      const updatedFlow = { ...baseFlow, default_style: style };
      const merged = { ...profileData, response_flow: updatedFlow };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, flow, onSave]
  );

  /** Save agent-level KB attachments and mode to response_flow.
   *  Reads base flow from profileData (not the hook's flow) to avoid
   *  accidentally persisting unsaved changes from other tabs. */
  const saveAgentKB = useCallback(
    async (kbAttachments: ScenarioKBAttachment[], mode: 'always' | 'fallback') => {
      const baseFlow = profileData.response_flow ?? flow;
      const updatedFlow = {
        ...baseFlow,
        fallback_kb_attachments: kbAttachments.length > 0 ? kbAttachments : undefined,
        agent_kb_mode: mode,
      };
      const merged = { ...profileData, response_flow: updatedFlow };
      await onSave({ profile_data: merged });
      toast.success('Saved');
    },
    [profileData, flow, onSave]
  );

  // ── Fallback tab save (still uses shared flow state) ──

  const [savingFallback, setSavingFallback] = useState(false);

  const handleSaveFallback = useCallback(async () => {
    setSavingFallback(true);
    try {
      const merged = { ...profileData, response_flow: flow };
      await onSave({ profile_data: merged });
      clearDirty();
      toast.success('Saved');
    } finally {
      setSavingFallback(false);
    }
  }, [profileData, flow, onSave, clearDirty]);

  const fallbackSaveFooter = dirty ? (
    <div className="flex items-center justify-end border-t pt-4 gap-2">
      <Button variant="outline" size="sm" onClick={reset}>
        Cancel
      </Button>
      <PlanGate>
        <Button size="sm" onClick={handleSaveFallback} disabled={savingFallback}>
          {savingFallback && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </PlanGate>
    </div>
  ) : null;

  // ── Accordion expand state for Defaults tab ──

  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const toggleStep = (step: string) =>
    setExpandedStep((prev) => (prev === step ? null : step));

  return (
    <Tabs defaultValue="defaults">
      <TabsList className="w-full">
        <TabsTrigger value="defaults" className="flex-1">Defaults</TabsTrigger>
        <TabsTrigger value="response-flow" className="flex-1">Response Flow</TabsTrigger>
        <TabsTrigger value="fallback" className="flex-1">Fallback Behavior</TabsTrigger>
      </TabsList>

      {/* ── Tab 1: Defaults ── */}
      <TabsContent value="defaults" className="space-y-3 pt-3">
        <p className="text-xs text-muted-foreground">
          Configure your agent's default behavior. These apply to all conversations unless overridden by a scenario.
        </p>

        {/* Step 1: Communication Style */}
        <StyleSection
          style={flow.default_style}
          isExpanded={expandedStep === 'style'}
          onToggle={() => toggleStep('style')}
          onSave={saveStyle}
        />

        {/* Step 2: Knowledge Base */}
        <AgentKBSection
          kbAttachments={flow.fallback_kb_attachments ?? []}
          agentKBMode={flow.agent_kb_mode ?? 'fallback'}
          knowledgeBases={knowledgeBases}
          isExpanded={expandedStep === 'kb'}
          onToggle={() => toggleStep('kb')}
          onSave={saveAgentKB}
        />

        {/* Step 3: Language Preferences */}
        <LanguageSection
          profileData={profileData}
          isExpanded={expandedStep === 'lang'}
          onToggle={() => toggleStep('lang')}
          onSave={saveProfileFields}
        />
      </TabsContent>

      {/* ── Tab 2: Response Flow ── */}
      <TabsContent value="response-flow" className="space-y-5 pt-1">
        <p className="text-xs text-muted-foreground">
          Define scenarios to handle specific types of messages with tailored responses, knowledge, and instructions.
        </p>
        <ResponseFlowSection
          profileData={profileData}
          agentId={agentId}
          flow={flow}
          knowledgeBases={knowledgeBases}
          addScenario={addScenario}
          updateScenario={updateScenario}
          removeScenario={removeScenario}
          onAutoSave={async (updatedFlow) => {
            const merged = { ...profileData, response_flow: updatedFlow };
            await onSave({ profile_data: merged });
            clearDirty();
          }}
        />
        {debugMode && (
          <PromptPreviewPanel profileData={{ ...profileData, response_flow: flow }} agentId={agentId} />
        )}
      </TabsContent>

      {/* ── Tab 3: Fallback Behavior ── */}
      <TabsContent value="fallback" className="space-y-4 pt-1">
        <p className="text-sm text-muted-foreground">
          How should your agent respond when a message doesn't match any scenario?
        </p>
        <FallbackToggle
          mode={flow.fallback_mode}
          onChange={setFallbackMode}
          fallbackStyle={flow.fallback_style}
          onFallbackStyleChange={setFallbackStyle}
        />
        {fallbackSaveFooter}
      </TabsContent>
    </Tabs>
  );
}
```

Key changes from the original:
- **Tabs:** 4 → 3 (Defaults, Response Flow, Fallback Behavior)
- **Defaults tab:** Contains 3 `SectionCard`-based steps with independent saves, controlled by `expandedStep` state (only one open at a time)
- **Style:** Moved from shared `saveFooter` to `StyleSection` with its own save
- **KB:** New `AgentKBSection` with `saveAgentKB` callback
- **Language:** Reused as-is, just moved into Defaults tab
- **Fallback:** Keeps shared `useResponseFlow` state for `dirty`/`save` since it modifies `fallback_mode`/`fallback_style`
- **Removed:** `updateDefaultStyle` from the `useResponseFlow` destructure (no longer needed here — `StyleSection` saves directly)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build. No unused import warnings.

- [ ] **Step 3: Visual verification in browser**

1. Navigate to an AI agent's detail page
2. Verify 3 tabs appear: "Defaults", "Response Flow", "Fallback Behavior"
3. In Defaults tab, verify 3 collapsible steps:
   - Communication Style — click Edit, change tone, Save → toast appears, card collapses with updated summary
   - Knowledge Base — click Set Up, attach a KB, toggle "Include in all messages", Save → card shows summary like "1 knowledge base attached (always included)"
   - Language — click Edit, change language, Save → works as before
4. Verify only one step can be expanded at a time
5. Response Flow tab — scenarios work as before
6. Fallback tab — fallback mode selection + save works as before

- [ ] **Step 4: Commit**

```bash
git add client/src/components/settings/AIAgentSections.tsx
git commit -m "feat: restructure AI agent page to 3-tab layout with accordion defaults"
```

---

## Chunk 6: Cleanup & Edge Cases

### Task 7: Verify backward compatibility with existing agents

- [ ] **Step 1: Check that agents without `agent_kb_mode` default correctly**

Open an existing agent that was created before this change. Verify:
- The Defaults tab → Knowledge Base step shows "No knowledge bases attached" with "Not configured" badge
- The `agent_kb_mode` defaults to `'fallback'` (the `?? 'fallback'` in `AgentKBSection` props handles this)

- [ ] **Step 2: Check that agents without `fallback_kb_attachments` render correctly**

The `flow.fallback_kb_attachments ?? []` fallback in `AIAgentSections` handles undefined. Verify no runtime errors.

- [ ] **Step 3: Check prompt builder backward compatibility**

The prompt builder condition `flow.agent_kb_mode === 'always'` only triggers when explicitly set. Existing agents with `undefined` will use fallback behavior (no change). Verify by checking the prompt preview panel in debug mode.
