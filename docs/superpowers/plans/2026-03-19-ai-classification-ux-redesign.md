# AI Classification UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the AI classification feature UX — move config from AI agents to company/channel level, replace buried ClassificationCard with a dedicated AI tab in the side panel, and add proper notification integration.

**Architecture:** Config hierarchy is company defaults → channel overrides. The side panel gains a 3rd "AI" tab as the classification hub. The wand button opens this tab. Backend reads config from new company/channel columns instead of `ai_agents.profile_data`. Notifications use the existing `createNotification` service with a new `'classification'` type.

**Tech Stack:** React, shadcn/ui, Tailwind, Express 5, Supabase (Postgres), Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-03-19-ai-classification-ux-redesign.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/067_classification_ux_redesign.sql` | New columns on companies + channel_agent_settings, notification type, data migration |
| `client/src/components/inbox/ClassificationTab.tsx` | AI tab content: analyze button, pending suggestions with checkboxes, history, settings links |
| `client/src/components/settings/CompanyClassificationSettings.tsx` | Company-level classification config card |
| `client/src/components/settings/ChannelClassificationSettings.tsx` | Channel-level classification config card |

### Modified Files
| File | What Changes |
|------|-------------|
| `server/src/routes/classification.ts` | Add company-settings, channel-settings, and status endpoints. Replace old GET/PUT /settings. |
| `server/src/services/classification.ts` | Refactor `classifyConversation` to read config from companies + channel_agent_settings columns instead of ai_agents.profile_data |
| `server/src/services/messageProcessor.ts` | No code change needed — it already calls `classifyConversation()` which handles config internally |
| `server/src/services/notificationService.ts` | Add `classification: true` to PREFERENCE_DEFAULTS |
| `server/src/types/index.ts` | Add ClassificationConfig interface |
| `client/src/pages/InboxPage.tsx` | Add `contactPanelTab` state, replace `onClassify` with `onOpenClassification`, pass `initialTab` to ContactPanel |
| `client/src/components/inbox/ContactPanel.tsx` | Add AI tab, convert to controlled tabs, accept `initialTab` prop |
| `client/src/components/inbox/ConversationHeader.tsx` | Replace `onClassify`/`classifying` props with `onOpenClassification` + badge dot |
| `client/src/hooks/useClassificationSuggestions.ts` | Add `hasPending` computed property for badge dot |
| `client/src/components/settings/ConversationSettingsTab.tsx` | Replace ClassificationModeSettings import with CompanyClassificationSettings |
| `client/src/components/settings/ChannelDetailView.tsx` | Add ChannelClassificationSettings card to AI Agent tab |
| `client/src/components/settings/AIAgentSections.tsx` | Remove ClassificationSettings import and rendering |

### Removed Files
| File | Reason |
|------|--------|
| `client/src/components/inbox/ClassificationCard.tsx` | Replaced by ClassificationTab.tsx |
| `client/src/components/agents/ClassificationSettings.tsx` | Config moved to company/channel level |
| `client/src/components/settings/ClassificationModeSettings.tsx` | Replaced by CompanyClassificationSettings |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/067_classification_ux_redesign.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 067_classification_ux_redesign.sql
-- Move classification config from ai_agents.profile_data to company + channel level

-- 1. New columns on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS classification_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_rules TEXT,
  ADD COLUMN IF NOT EXISTS classification_auto_classify BOOLEAN NOT NULL DEFAULT false;

-- 2. New columns on channel_agent_settings
ALTER TABLE channel_agent_settings
  ADD COLUMN IF NOT EXISTS classification_override TEXT NOT NULL DEFAULT 'company_defaults'
    CHECK (classification_override IN ('company_defaults', 'custom', 'disabled')),
  ADD COLUMN IF NOT EXISTS classification_mode TEXT
    CHECK (classification_mode IS NULL OR classification_mode IN ('suggest', 'auto_apply')),
  ADD COLUMN IF NOT EXISTS classification_auto_classify BOOLEAN,
  ADD COLUMN IF NOT EXISTS classification_rules TEXT;

-- 3. Add 'classification' notification type
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'share', 'message_assigned', 'message_accessible',
    'snooze_set', 'schedule_set', 'schedule_sent',
    'status_change', 'contact_note', 'handoff',
    'group_criteria_match', 'classification'
  ));

-- 4. Update notification_preferences default to include classification
ALTER TABLE notification_preferences
  ALTER COLUMN preferences SET DEFAULT '{
    "assignment": true,
    "share": true,
    "message_assigned": true,
    "message_accessible": false,
    "snooze_set": true,
    "schedule_set": true,
    "schedule_sent": true,
    "status_change": true,
    "contact_note": true,
    "handoff": true,
    "group_criteria_match": true,
    "classification": true
  }'::jsonb;

-- 5. Backfill existing notification_preferences rows with classification default
UPDATE notification_preferences
  SET preferences = preferences || '{"classification": true}'::jsonb
  WHERE NOT (preferences ? 'classification');

-- 6. Data migration: move config from ai_agents.profile_data.classification
-- For channels with agents that had classification enabled: set custom override
-- For channels with agents that had classification disabled or missing: set disabled
-- This ensures no channel gains classification that didn't have it before
DO $$
DECLARE
  r RECORD;
  agent_classification JSONB;
BEGIN
  FOR r IN
    SELECT cas.id AS cas_id, cas.agent_id, cas.company_id, a.profile_data
    FROM channel_agent_settings cas
    JOIN ai_agents a ON a.id = cas.agent_id
    WHERE cas.agent_id IS NOT NULL
  LOOP
    agent_classification := r.profile_data -> 'classification';

    IF agent_classification IS NOT NULL AND (agent_classification ->> 'enabled')::boolean = true THEN
      -- Channel had classification enabled via agent — migrate to custom
      UPDATE channel_agent_settings SET
        classification_override = 'custom',
        classification_auto_classify = COALESCE((agent_classification ->> 'auto_classify_new')::boolean, false),
        classification_rules = agent_classification ->> 'rules'
      WHERE id = r.cas_id;

      -- Enable company-level classification for this company
      UPDATE companies SET classification_enabled = true WHERE id = r.company_id;
    ELSE
      -- Channel did NOT have classification — set disabled to preserve behavior
      UPDATE channel_agent_settings SET classification_override = 'disabled'
      WHERE id = r.cas_id;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/067_classification_ux_redesign.sql
git commit -m "feat: add migration for classification UX redesign — new columns + data migration"
```

- [ ] **Step 3: Run the migration**

Ask user for permission, then:
```bash
source server/.env && psql "$SUPABASE_DB_URL" -f supabase/migrations/067_classification_ux_redesign.sql
```

---

## Task 2: Backend — Config Resolution & Routes

**Files:**
- Modify: `server/src/services/classification.ts` (lines 547-581)
- Modify: `server/src/routes/classification.ts` (lines 152-194, add new routes)
- Modify: `server/src/services/notificationService.ts` (line 12-24)

- [ ] **Step 1: Add `classification` to notification PREFERENCE_DEFAULTS**

In `server/src/services/notificationService.ts`, add to the `PREFERENCE_DEFAULTS` object (after line 23):

```typescript
  group_criteria_match: true,
  classification: true,
```

- [ ] **Step 2: Refactor config resolution in classification service**

In `server/src/services/classification.ts`, replace lines 547-581 (the section that reads from `channel_agent_settings.agent_id` → `ai_agents.profile_data.classification`):

Replace the block from `// 2. Fetch channel_agent_settings` through `const rules = classificationConfig.rules ?? '';` with:

```typescript
  // 2. Resolve classification config from company + channel settings
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('classification_enabled, classification_mode, classification_auto_classify, classification_rules')
    .eq('id', companyId)
    .single();

  if (!company?.classification_enabled) {
    console.log('[classify] BAIL: company classification disabled');
    return null;
  }

  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('classification_override, classification_mode, classification_auto_classify, classification_rules')
    .eq('channel_id', channelId)
    .eq('company_id', companyId)
    .single();

  const override = channelSettings?.classification_override ?? 'company_defaults';

  if (override === 'disabled') {
    console.log('[classify] BAIL: channel classification disabled');
    return null;
  }

  // Resolve effective config: channel custom overrides company defaults
  const effectiveMode = override === 'custom' && channelSettings?.classification_mode
    ? channelSettings.classification_mode
    : company.classification_mode ?? 'suggest';

  const effectiveAutoClassify = override === 'custom' && channelSettings?.classification_auto_classify !== null
    ? channelSettings.classification_auto_classify
    : company.classification_auto_classify ?? false;

  // For auto trigger, skip if auto-classify is disabled
  if (trigger === 'auto' && !effectiveAutoClassify) {
    console.log('[classify] BAIL: auto-classify disabled');
    return null;
  }

  // Rules: company rules + channel rules (additive)
  const companyRules = company.classification_rules ?? '';
  const channelRules = (override === 'custom' ? channelSettings?.classification_rules : null) ?? '';
  const rules = [companyRules, channelRules].filter(Boolean).join('\n\n');
```

Also update the auto-apply check later in the function (~line 681). Replace the block that queries `companies.classification_mode` with:

```typescript
  if (effectiveMode === 'auto_apply') {
```

(Remove the separate query for `companies.classification_mode` since we already have it.)

- [ ] **Step 3: Add new API endpoints for config management**

In `server/src/routes/classification.ts`, **delete** the existing `GET /settings` and `PUT /settings` route handlers entirely (lines 152-194), then add these new routes in their place:

```typescript
// GET /company-settings — get all company classification config
router.get('/company-settings', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('classification_enabled, classification_mode, classification_auto_classify, classification_rules')
      .eq('id', companyId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PUT /company-settings — update company classification config
router.put('/company-settings', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { classification_enabled, classification_mode, classification_auto_classify, classification_rules } = req.body;

    const update: Record<string, unknown> = {};
    if (typeof classification_enabled === 'boolean') update.classification_enabled = classification_enabled;
    if (classification_mode === 'suggest' || classification_mode === 'auto_apply') update.classification_mode = classification_mode;
    if (typeof classification_auto_classify === 'boolean') update.classification_auto_classify = classification_auto_classify;
    if (typeof classification_rules === 'string') update.classification_rules = classification_rules;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const { error } = await supabaseAdmin.from('companies').update(update).eq('id', companyId);
    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /channel-settings/:channelId — get channel classification config
router.get('/channel-settings/:channelId', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = req.params.channelId as string;

    const { data, error } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('classification_override, classification_mode, classification_auto_classify, classification_rules')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .single();

    if (error) throw error;
    res.json(data || { classification_override: 'company_defaults', classification_mode: null, classification_auto_classify: null, classification_rules: null });
  } catch (err) {
    next(err);
  }
});

// PUT /channel-settings/:channelId — update channel classification config
router.put('/channel-settings/:channelId', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = req.params.channelId as string;
    const { classification_override, classification_mode, classification_auto_classify, classification_rules } = req.body;

    const update: Record<string, unknown> = {};
    if (['company_defaults', 'custom', 'disabled'].includes(classification_override)) update.classification_override = classification_override;
    if (classification_mode === 'suggest' || classification_mode === 'auto_apply' || classification_mode === null) update.classification_mode = classification_mode;
    if (typeof classification_auto_classify === 'boolean' || classification_auto_classify === null) update.classification_auto_classify = classification_auto_classify;
    if (typeof classification_rules === 'string' || classification_rules === null) update.classification_rules = classification_rules;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('channel_agent_settings')
      .update(update)
      .eq('channel_id', channelId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// GET /status/:sessionId — resolved config + channel info for the AI tab
router.get('/status/:sessionId', requirePermission('conversations', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const sessionId = req.params.sessionId as string;

    // Get session's channel_id
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    // Get company config
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('classification_enabled, classification_mode, classification_auto_classify')
      .eq('id', companyId)
      .single();

    // Get channel config
    const { data: channelSettings } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('classification_override, classification_mode, classification_auto_classify')
      .eq('channel_id', session.channel_id)
      .eq('company_id', companyId)
      .single();

    const override = channelSettings?.classification_override ?? 'company_defaults';
    const enabled = company?.classification_enabled && override !== 'disabled';

    res.json({
      enabled,
      channel_id: session.channel_id,
      mode: override === 'custom' && channelSettings?.classification_mode
        ? channelSettings.classification_mode
        : company?.classification_mode ?? 'suggest',
      override,
    });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Add notification after classification**

In `server/src/services/classification.ts`, after the suggestion is inserted (after the `if (insertError)` check, ~line 672), add notification logic:

```typescript
  // Notify company members about classification
  if (trigger === 'auto') {
    const { data: members } = await supabaseAdmin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId);

    // NOTE: Currently notifies all company members. Consider scoping to
    // assigned agent / conversation participants if this is too noisy.
    if (members && members.length > 0) {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('first_name, last_name')
        .eq('id', contactId)
        .single();

      const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Unknown';
      const isAutoApply = effectiveMode === 'auto_apply';

      const title = isAutoApply
        ? `AI classified ${contactName}`
        : `AI has suggestions for ${contactName}`;

      // Build a human-readable summary of what was classified
      const appliedItems: string[] = [];
      if (filtered.labels?.length) appliedItems.push(...filtered.labels.map((l) => l.name));
      if (filtered.priority) appliedItems.push(`Priority: ${filtered.priority.name}`);
      if (filtered.status) appliedItems.push(`Status: ${filtered.status.name}`);
      if (filtered.contact_tags?.length) appliedItems.push(...filtered.contact_tags.map((t) => t.name));
      if (filtered.contact_lists?.length) appliedItems.push(...filtered.contact_lists.map((l) => l.name));

      const body = isAutoApply && appliedItems.length > 0
        ? `Applied: ${appliedItems.join(', ')}`
        : undefined;

      createNotificationsForUsers(
        companyId,
        members.map((m: { user_id: string }) => m.user_id),
        'classification',
        title,
        body,
        { conversation_id: sessionId, channel_id: channelId }
      ).catch((err) => console.error('Classification notification failed:', err));
    }
  }
```

Add the import at the top of the file:
```typescript
import { createNotificationsForUsers } from './notificationService.js';
```

- [ ] **Step 5: Remove debug logging**

Remove all the `console.log('[classify]` and `console.log('[route]` debug lines that were added during troubleshooting.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/classification.ts server/src/routes/classification.ts server/src/services/notificationService.ts
git commit -m "feat: refactor classification config to company/channel level + add config API endpoints + notifications"
```

---

## Task 3: Frontend — ClassificationTab Component

**Files:**
- Create: `client/src/components/inbox/ClassificationTab.tsx`
- Modify: `client/src/hooks/useClassificationSuggestions.ts`

- [ ] **Step 1: Add `hasPending` to the hook**

In `client/src/hooks/useClassificationSuggestions.ts`, add after line 42:

```typescript
  const hasPending = suggestions.some((s) => s.status === 'pending');
```

Add it to the return object (line 96-105):

```typescript
  return {
    suggestions,
    loading,
    classifying,
    hasPending,
    classify,
    accept,
    dismiss,
    acceptPartial,
    refetch: fetchSuggestions,
  };
```

- [ ] **Step 2: Create ClassificationTab component**

Create `client/src/components/inbox/ClassificationTab.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, X, Wand2, Zap, Settings } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import {
  useClassificationSuggestions,
  type ClassificationSuggestion,
  type SuggestionItem,
  type PartialAccept,
} from '@/hooks/useClassificationSuggestions';

interface ClassificationTabProps {
  sessionId: string | null;
}

interface ClassificationStatus {
  enabled: boolean;
  channel_id: number | null;
  mode: string;
  override: string;
}

// ── Pending Suggestion Card ──────────────────────────────────

function PendingSuggestionCard({
  suggestion,
  onAccept,
  onAcceptPartial,
  onDismiss,
}: {
  suggestion: ClassificationSuggestion;
  onAccept: (id: string) => Promise<void>;
  onAcceptPartial: (id: string, partial: PartialAccept) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const s = suggestion.suggestions;
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Track which items are checked (all checked by default)
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(
    new Set((s.labels ?? []).map((l) => l.id))
  );
  const [checkedPriority, setCheckedPriority] = useState(!!s.priority);
  const [checkedStatus, setCheckedStatus] = useState(!!s.status);
  const [checkedTags, setCheckedTags] = useState<Set<string>>(
    new Set((s.contact_tags ?? []).map((t) => t.id))
  );
  const [checkedLists, setCheckedLists] = useState<Set<string>>(
    new Set((s.contact_lists ?? []).map((l) => l.id))
  );

  const allChecked =
    checkedLabels.size === (s.labels ?? []).length &&
    checkedPriority === !!s.priority &&
    checkedStatus === !!s.status &&
    checkedTags.size === (s.contact_tags ?? []).length &&
    checkedLists.size === (s.contact_lists ?? []).length;

  const noneChecked =
    checkedLabels.size === 0 &&
    !checkedPriority &&
    !checkedStatus &&
    checkedTags.size === 0 &&
    checkedLists.size === 0;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      if (allChecked) {
        await onAccept(suggestion.id);
      } else {
        const partial: PartialAccept = {
          labels: Array.from(checkedLabels),
          priority: checkedPriority,
          status: checkedStatus,
          contact_tags: Array.from(checkedTags),
          contact_lists: Array.from(checkedLists),
        };
        await onAcceptPartial(suggestion.id, partial);
      }
      toast.success('Classification applied');
    } catch {
      toast.error('Failed to apply classification');
    } finally {
      setAccepting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(suggestion.id);
      toast.success('Suggestions dismissed');
    } catch {
      toast.error('Failed to dismiss');
    } finally {
      setDismissing(false);
    }
  };

  const toggleInSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const renderItems = (label: string, items: SuggestionItem[] | undefined, checked: Set<string>, setter: (s: Set<string>) => void) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={checked.has(item.id)}
              onCheckedChange={() => toggleInSet(checked, item.id, setter)}
            />
            <span>{item.name || item.id}</span>
            <Badge variant="secondary" className="text-[10px] ml-auto" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
              {Math.round(item.confidence * 100)}%
            </Badge>
          </label>
        ))}
      </div>
    );
  };

  const renderSingle = (label: string, item: SuggestionItem | undefined, checked: boolean, setter: (v: boolean) => void) => {
    if (!item) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={checked} onCheckedChange={() => setter(!checked)} />
          <span>{item.name || item.id}</span>
          <Badge variant="secondary" className="text-[10px] ml-auto" style={{ opacity: 0.6 + item.confidence * 0.4 }}>
            {Math.round(item.confidence * 100)}%
          </Badge>
        </label>
      </div>
    );
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {renderItems('Labels', s.labels, checkedLabels, setCheckedLabels)}
        {renderSingle('Priority', s.priority, checkedPriority, setCheckedPriority)}
        {renderSingle('Status', s.status, checkedStatus, setCheckedStatus)}
        {renderItems('Contact Tags', s.contact_tags, checkedTags, setCheckedTags)}
        {renderItems('Contact Lists', s.contact_lists, checkedLists, setCheckedLists)}

        {s.reasoning && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Reasoning
            </button>
            {expanded && <p className="mt-1 text-xs text-muted-foreground">{s.reasoning}</p>}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleAccept} disabled={accepting || dismissing || noneChecked}>
            {accepting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            {allChecked ? 'Accept All' : 'Accept Selected'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDismiss} disabled={accepting || dismissing}>
            {dismissing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── History Entry ────────────────────────────────────────────

function HistoryEntry({ suggestion }: { suggestion: ClassificationSuggestion }) {
  const s = suggestion.suggestions;
  const categories = Object.keys(s).filter((k) => k !== 'reasoning');

  return (
    <div className="flex items-start gap-2 py-2 border-b last:border-0">
      <span className="mt-0.5 text-muted-foreground">
        {suggestion.trigger === 'auto' ? <Zap className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium capitalize">{suggestion.status}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(suggestion.created_at).toLocaleDateString()} {new Date(suggestion.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {categories.join(', ')}
        </p>
      </div>
    </div>
  );
}

// ── Main ClassificationTab ───────────────────────────────────

export default function ClassificationTab({ sessionId }: ClassificationTabProps) {
  const { suggestions, loading, classifying, classify, accept, dismiss, acceptPartial } =
    useClassificationSuggestions(sessionId);

  const [status, setStatus] = useState<ClassificationStatus | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/classification/status/${sessionId}`)
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus(null));
  }, [sessionId]);

  if (!sessionId) return null;

  // Disabled state
  if (status && !status.enabled) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground space-y-2">
        <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/50" />
        <p>Classification is not enabled.</p>
        <Button variant="link" size="sm" asChild>
          <a href="/settings/conversations">Enable in settings</a>
        </Button>
      </div>
    );
  }

  const pending = suggestions.filter((s) => s.status === 'pending');
  const history = suggestions.filter((s) => s.status !== 'pending');
  const visibleHistory = showAllHistory ? history : history.slice(0, 3);

  return (
    <div className="p-4 space-y-4">
      {/* Analyze button */}
      <Button
        className="w-full"
        variant={pending.length > 0 ? 'outline' : 'default'}
        onClick={() => classify().catch(() => toast.error('Classification failed'))}
        disabled={classifying || loading}
      >
        {classifying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        {classifying ? 'Analyzing...' : 'Analyze Conversation'}
      </Button>

      {/* Pending suggestions */}
      {pending.map((s) => (
        <PendingSuggestionCard
          key={s.id}
          suggestion={s}
          onAccept={accept}
          onAcceptPartial={acceptPartial}
          onDismiss={dismiss}
        />
      ))}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">History</h4>
          {visibleHistory.map((s) => (
            <HistoryEntry key={s.id} suggestion={s} />
          ))}
          {history.length > 3 && !showAllHistory && (
            <button
              onClick={() => setShowAllHistory(true)}
              className="text-xs text-primary hover:underline mt-1"
            >
              Show all ({history.length})
            </button>
          )}
        </div>
      )}

      {/* Settings links */}
      <div className="pt-2 border-t space-y-1">
        <a href="/settings/conversations" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings className="h-3 w-3" /> Company classification settings
        </a>
        {status?.channel_id && (
          <a href={`/settings/channels/${status.channel_id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Settings className="h-3 w-3" /> Channel classification settings
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/inbox/ClassificationTab.tsx client/src/hooks/useClassificationSuggestions.ts
git commit -m "feat: add ClassificationTab component with checkboxes, history, and settings links"
```

---

## Task 4: Frontend — Rewire ContactPanel, Header, InboxPage

**Files:**
- Modify: `client/src/components/inbox/ContactPanel.tsx`
- Modify: `client/src/components/inbox/ConversationHeader.tsx`
- Modify: `client/src/pages/InboxPage.tsx`

- [ ] **Step 1: Add AI tab to ContactPanel**

In `client/src/components/inbox/ContactPanel.tsx`:

1. Replace `ClassificationCard` import with `ClassificationTab`:
```typescript
import ClassificationTab from './ClassificationTab';
```

2. Add `initialTab` to the props interface AND the function destructuring:
```typescript
interface ContactPanelProps {
  contactId: string | null;
  sessionId?: string | null;
  open: boolean;
  onClose: () => void;
  initialTab?: 'info' | 'notes' | 'ai';
  // ... existing props
}
```

Also add `initialTab` to the function signature destructuring:
```typescript
export default function ContactPanel({ contactId, sessionId, open, onClose, initialTab, onProfilePictureLoaded, previewName, previewPhone, previewPicture }: ContactPanelProps) {
```

3. Add controlled tab state inside the component:
```typescript
const [activeTab, setActiveTab] = useState(initialTab ?? 'info');

useEffect(() => {
  if (open) setActiveTab(initialTab ?? 'info');
}, [open, initialTab]);
```

4. Convert Tabs from uncontrolled to controlled:
```tsx
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'info' | 'notes' | 'ai')} className="w-full">
```

5. Add the AI tab trigger after Notes:
```tsx
<TabsTrigger value="ai" className="flex-1">AI</TabsTrigger>
```

6. Add the AI tab content (before the closing `</Tabs>`):
```tsx
<TabsContent value="ai" className="mt-0">
  <ClassificationTab sessionId={sessionId ?? null} />
</TabsContent>
```

7. Remove the `ClassificationCard` rendering from the Info tab (the `{sessionId && !editing && (` block).

- [ ] **Step 2: Update ConversationHeader**

In `client/src/components/inbox/ConversationHeader.tsx`:

1. Replace props:
```typescript
// Remove:
onClassify?: () => void;
classifying?: boolean;

// Add:
onOpenClassification?: () => void;
hasPendingSuggestions?: boolean;
```

2. Update the wand button (~line 474-485):
```tsx
{onOpenClassification && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" onClick={onOpenClassification}>
          <Wand2 className="h-4 w-4" />
          {hasPendingSuggestions && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>AI Classification</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

- [ ] **Step 3: Update InboxPage**

In `client/src/pages/InboxPage.tsx`:

1. Add tab state:
```typescript
const [contactPanelTab, setContactPanelTab] = useState<'info' | 'notes' | 'ai'>('info');
```

2. Update the `useClassificationSuggestions` usage — keep it for `hasPending`:
```typescript
const { hasPending } = useClassificationSuggestions(activeConversation?.id ?? null);
```

3. Remove `classifying` and `classify` from the destructured hook return. **Important:** This must be done together with removing their usage in the JSX below (the `onClassify` and `classifying` props on ConversationHeader) — otherwise the build breaks.

4. Update ConversationHeader props:
```tsx
onOpenClassification={() => {
  setContactPanelTab('ai');
  setContactPanelOpen(true);
}}
hasPendingSuggestions={hasPending}
```

5. Remove the old `onClassify` and `classifying` props.

6. Update ContactPanel props:
```tsx
<ContactPanel
  contactId={activeConversation.contact_id}
  sessionId={activeConversation.id}
  open={contactPanelOpen}
  onClose={() => {
    setContactPanelOpen(false);
    setContactPanelTab('info');
  }}
  initialTab={contactPanelTab}
  // ... existing props
/>
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/inbox/ContactPanel.tsx client/src/components/inbox/ConversationHeader.tsx client/src/pages/InboxPage.tsx
git commit -m "feat: rewire side panel with AI tab, wand opens classification, badge dot for pending"
```

---

## Task 5: Frontend — Settings Components

**Files:**
- Create: `client/src/components/settings/CompanyClassificationSettings.tsx`
- Create: `client/src/components/settings/ChannelClassificationSettings.tsx`
- Modify: `client/src/components/settings/ConversationSettingsTab.tsx`
- Modify: `client/src/components/settings/ChannelDetailView.tsx`
- Modify: `client/src/components/settings/AIAgentSections.tsx`

- [ ] **Step 1: Create CompanyClassificationSettings**

Create `client/src/components/settings/CompanyClassificationSettings.tsx`:

```typescript
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
```

- [ ] **Step 2: Create ChannelClassificationSettings**

Create `client/src/components/settings/ChannelClassificationSettings.tsx`:

```typescript
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

interface ChannelClassificationConfig {
  classification_override: string;
  classification_mode: string | null;
  classification_auto_classify: boolean | null;
  classification_rules: string | null;
}

export default function ChannelClassificationSettings({ channelId }: { channelId: number | string }) {
  const [config, setConfig] = useState<ChannelClassificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/classification/channel-settings/${channelId}`)
      .then(({ data }) => setConfig(data))
      .catch(() => toast.error('Failed to load channel classification settings'))
      .finally(() => setLoading(false));
  }, [channelId]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.put(`/classification/channel-settings/${channelId}`, config);
      toast.success('Channel classification settings saved');
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
          Override company classification settings for this channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Classification for this channel</Label>
          <Select
            value={config.classification_override}
            onValueChange={(v) => setConfig({ ...config, classification_override: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company_defaults">Use company defaults</SelectItem>
              <SelectItem value="custom">Custom settings</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {config.classification_override === 'custom' && (
          <>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={config.classification_mode ?? 'suggest'}
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
              <Label htmlFor="channel-auto-classify">Auto-classify new conversations</Label>
              <Switch
                id="channel-auto-classify"
                checked={config.classification_auto_classify ?? false}
                onCheckedChange={(v) => setConfig({ ...config, classification_auto_classify: v })}
              />
            </div>

            <div className="space-y-2">
              <Label>Channel-specific rules</Label>
              <Textarea
                value={config.classification_rules ?? ''}
                onChange={(e) => setConfig({ ...config, classification_rules: e.target.value })}
                placeholder="Additional rules for this channel..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                These rules are used in addition to company-level rules.
              </p>
            </div>
          </>
        )}

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>

        <p className="text-xs text-muted-foreground">
          <a href="/settings/conversations" className="text-primary hover:underline">Company-level classification settings →</a>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Update ConversationSettingsTab**

In `client/src/components/settings/ConversationSettingsTab.tsx`:

1. Replace the import:
```typescript
// Remove: import ClassificationModeSettings from './ClassificationModeSettings';
// Add:
import CompanyClassificationSettings from './CompanyClassificationSettings';
```

2. Replace `<ClassificationModeSettings />` with `<CompanyClassificationSettings />`.

- [ ] **Step 4: Add ChannelClassificationSettings to ChannelDetailView**

In `client/src/components/settings/ChannelDetailView.tsx`:

1. Import the component:
```typescript
import ChannelClassificationSettings from './ChannelClassificationSettings';
```

2. Add the card inside the "ai-agent" TabsContent (before the closing `</TabsContent>`):
```tsx
<ChannelClassificationSettings channelId={numericChannelId} />
```

Note: The component uses `const { channelId } = useParams()` then `const numericChannelId = Number(channelId)`. Use `numericChannelId` to match the existing pattern.

- [ ] **Step 5: Remove classification from AI agent settings**

In `client/src/components/settings/AIAgentSections.tsx`:

1. Remove the import: `import ClassificationSettings from '../agents/ClassificationSettings';`
2. Remove the `<ClassificationSettings ... />` rendering from the Defaults tab.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/CompanyClassificationSettings.tsx client/src/components/settings/ChannelClassificationSettings.tsx client/src/components/settings/ConversationSettingsTab.tsx client/src/components/settings/ChannelDetailView.tsx client/src/components/settings/AIAgentSections.tsx
git commit -m "feat: add company + channel classification settings, remove from AI agent config"
```

---

## Task 6: Cleanup — Remove Old Components

**Files:**
- Delete: `client/src/components/inbox/ClassificationCard.tsx`
- Delete: `client/src/components/agents/ClassificationSettings.tsx`
- Delete: `client/src/components/settings/ClassificationModeSettings.tsx`

- [ ] **Step 1: Delete old files**

```bash
git rm client/src/components/inbox/ClassificationCard.tsx
git rm client/src/components/agents/ClassificationSettings.tsx
git rm client/src/components/settings/ClassificationModeSettings.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Search for any remaining references to the deleted components:

```bash
grep -r "ClassificationCard\|ClassificationModeSettings\|agents/ClassificationSettings" client/src/ --include="*.tsx" --include="*.ts"
```

Fix any remaining references.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Fix any TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old classification components (ClassificationCard, ClassificationModeSettings, agent ClassificationSettings)"
```

---

## Task 7: Build Verification & Smoke Test

- [ ] **Step 1: Full build**

```bash
npm run build
```

All TypeScript errors must be resolved.

- [ ] **Step 2: Manual smoke test checklist**

1. Open inbox → click wand icon → side panel opens to AI tab
2. Click "Analyze Conversation" → spinner → suggestions appear with checkboxes
3. Uncheck some items → click "Accept Selected" → toast "Classification applied"
4. Check history shows the accepted entry
5. Open Settings > Conversations → AI Classification card with all fields
6. Toggle enable, change mode, set rules, save
7. Open Channel settings → AI Classification card with override dropdown
8. Set to "Custom", change settings, save
9. Set to "Disabled", save
10. Check wand badge dot appears when suggestions are pending

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address build and smoke test issues"
```
