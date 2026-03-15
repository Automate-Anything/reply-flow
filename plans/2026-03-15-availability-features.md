# Availability Features Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add channel auto-reply (when AI is off), two new AI schedule modes ("When Away" and "Outside Business Hours"), and a team availability dashboard in company settings.

**Architecture:** Three independent subsystems sharing the existing availability infrastructure (users.personal_hours, auto_assign_members.is_available, holidays table). Channel auto-reply is a new per-channel feature that sends a configurable message on first contact when team is unavailable. AI schedule gets two new modes evaluated in `shouldAIRespond()`. Team dashboard is a read-only view in company settings showing member status, hours, and AI assignment.

**Tech Stack:** PostgreSQL (Supabase), Express.js, React + Tailwind + shadcn/ui

---

## Sub-Plan A: Channel Auto-Reply (When AI is Off)

### Overview

When the AI agent is **disabled** for a channel, the channel can optionally send a generic auto-reply message. The auto-reply triggers on the **first message of a new session** only (not every message). The user configures:

1. Whether auto-reply is enabled
2. The auto-reply message text
3. The trigger condition:
   - **Outside business hours** — sends when the current time is outside the company's business hours
   - **When all assigned members are unavailable** — sends when all team members assigned to the channel's auto-assign rule are Away

**Override logic:** Availability status overrides business hours. If someone is manually Available outside hours → no auto-reply. If everyone is Away during business hours → auto-reply fires.

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/055_channel_auto_reply.sql` | Add auto-reply columns to `channel_agent_settings` |
| Modify | `server/src/services/messageProcessor.ts` | Check auto-reply conditions on first session message |
| Create | `server/src/services/autoReplyEvaluator.ts` | Pure logic: evaluate whether auto-reply should fire |
| Modify | `server/src/routes/ai.ts` | Accept auto-reply settings in channel settings PUT endpoint |
| Modify | `client/src/components/settings/ChannelDetailView.tsx` | Show auto-reply config UI when AI is off |
| Create | `client/src/components/settings/sections/AutoReplySection.tsx` | Auto-reply config form component |

---

### Task 1: Database migration for auto-reply columns

**Files:**
- Create: `supabase/migrations/055_channel_auto_reply.sql`

- [ ] **Step 1: Write the migration**

Add three columns to `channel_agent_settings`:

```sql
-- Auto-reply settings (used when AI agent is disabled for the channel)
ALTER TABLE channel_agent_settings
  ADD COLUMN auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_reply_message TEXT DEFAULT NULL,
  ADD COLUMN auto_reply_trigger TEXT NOT NULL DEFAULT 'outside_hours'
    CHECK (auto_reply_trigger IN ('outside_hours', 'all_unavailable'));

COMMENT ON COLUMN channel_agent_settings.auto_reply_enabled IS 'When true and AI is off, sends auto_reply_message based on trigger condition.';
COMMENT ON COLUMN channel_agent_settings.auto_reply_message IS 'The message to send as auto-reply. Required when auto_reply_enabled is true.';
COMMENT ON COLUMN channel_agent_settings.auto_reply_trigger IS 'outside_hours: fires outside business hours. all_unavailable: fires when all assigned members are Away. Availability always overrides hours.';
```

- [ ] **Step 2: Run migration**

```bash
source server/.env && psql "$SUPABASE_DB_URL" -f supabase/migrations/055_channel_auto_reply.sql
```

- [ ] **Step 3: Verify**

```bash
source server/.env && psql "$SUPABASE_DB_URL" -c "\d channel_agent_settings" | grep auto_reply
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/055_channel_auto_reply.sql
git commit -m "feat: add auto-reply columns to channel_agent_settings"
```

---

### Task 2: Create auto-reply evaluator service

**Files:**
- Create: `server/src/services/autoReplyEvaluator.ts`

- [ ] **Step 1: Create the evaluator**

This is a pure logic module that determines whether an auto-reply should fire. It needs:
- The channel's auto-reply settings (enabled, trigger, message)
- The channel's AI enabled status (auto-reply only works when AI is OFF)
- Company business hours + timezone (for `outside_hours` trigger)
- Channel's auto-assign rule members' availability (for `all_unavailable` trigger)
- Whether this is the first message in the session

```typescript
// server/src/services/autoReplyEvaluator.ts
import { supabaseAdmin } from '../config/supabase.js';
import { isWithinSchedule, type BusinessHours } from './ai.js';

interface AutoReplyResult {
  shouldReply: boolean;
  message?: string;
}

/**
 * Evaluates whether a channel should send an auto-reply for this message.
 * Only fires on the FIRST message of a new session when AI is OFF.
 *
 * Override logic:
 * - If trigger is 'outside_hours' but someone is manually Available → no reply
 * - If trigger is 'all_unavailable' and everyone is Away (even during hours) → reply
 * - If trigger is 'outside_hours' and it's outside hours but someone is Available → no reply
 */
export async function evaluateAutoReply(
  channelId: number,
  companyId: string,
  isFirstMessageInSession: boolean
): Promise<AutoReplyResult> {
  // Only fire on first message
  if (!isFirstMessageInSession) return { shouldReply: false };

  // Fetch channel settings
  const { data: settings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('is_enabled, auto_reply_enabled, auto_reply_message, auto_reply_trigger')
    .eq('channel_id', channelId)
    .single();

  // Auto-reply only works when AI is OFF
  if (!settings || settings.is_enabled) return { shouldReply: false };
  if (!settings.auto_reply_enabled || !settings.auto_reply_message?.trim()) {
    return { shouldReply: false };
  }

  const trigger = settings.auto_reply_trigger;
  const message = settings.auto_reply_message.trim();

  // Check availability of assigned members for this channel
  const { data: rule } = await supabaseAdmin
    .from('auto_assign_rules')
    .select('id')
    .eq('company_id', companyId)
    .eq('channel_id', channelId)
    .eq('is_active', true)
    .single();

  // Also check company-wide rule
  const { data: companyRule } = await supabaseAdmin
    .from('auto_assign_rules')
    .select('id')
    .eq('company_id', companyId)
    .is('channel_id', null)
    .eq('is_active', true)
    .single();

  const ruleId = rule?.id || companyRule?.id;

  let allUnavailable = false;
  let someoneAvailable = false;

  if (ruleId) {
    const { data: members } = await supabaseAdmin
      .from('auto_assign_members')
      .select('is_available')
      .eq('rule_id', ruleId);

    if (members && members.length > 0) {
      allUnavailable = members.every(m => !m.is_available);
      someoneAvailable = members.some(m => m.is_available);
    }
  }

  // Fetch company hours and timezone
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('timezone, business_hours')
    .eq('id', companyId)
    .single();

  const timezone = company?.timezone || 'UTC';
  const businessHours = company?.business_hours as BusinessHours | null;
  const withinHours = businessHours ? isWithinSchedule(businessHours, timezone) : true;

  if (trigger === 'outside_hours') {
    // Outside hours trigger — but availability overrides
    if (someoneAvailable) return { shouldReply: false }; // Someone is manually available
    if (!withinHours) return { shouldReply: true, message };
    if (allUnavailable) return { shouldReply: true, message }; // All Away during hours
    return { shouldReply: false };
  }

  if (trigger === 'all_unavailable') {
    // All unavailable trigger — but availability overrides
    if (someoneAvailable) return { shouldReply: false };
    if (allUnavailable) return { shouldReply: true, message };
    // No auto-assign rule or no members — check hours as fallback
    if (!ruleId && !withinHours) return { shouldReply: true, message };
    return { shouldReply: false };
  }

  return { shouldReply: false };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/autoReplyEvaluator.ts
git commit -m "feat: add auto-reply evaluator service"
```

---

### Task 3: Integrate auto-reply into message processor

**Files:**
- Modify: `server/src/services/messageProcessor.ts`

- [ ] **Step 1: Add auto-reply check after session creation/reuse**

In `processIncomingMessage()`, after the session is created or reused (around line 320), and BEFORE the AI check:

```typescript
import { evaluateAutoReply } from './autoReplyEvaluator.js';

// After session creation (line ~320):
// isNewSession is true when we just created a fresh session
const autoReplyResult = await evaluateAutoReply(channelId, companyId, isNewSession);
if (autoReplyResult.shouldReply && autoReplyResult.message) {
  // Send auto-reply (reuse the same sendOutsideHoursReply or a similar function)
  sendOutsideHoursReply(companyId, sessionId, channelId, autoReplyResult.message)
    .catch(err => console.error('Auto-reply error:', err));
  return; // Don't proceed to AI check
}
```

**Key:** Need to track whether this is a new session. The code already knows this — when `createNewSession()` is called, it's a new session. When the existing session is reused, it's not. Add a `isNewSession` boolean flag based on this logic.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/messageProcessor.ts
git commit -m "feat: integrate auto-reply into message processor"
```

---

### Task 4: Accept auto-reply settings in channel settings API

**Files:**
- Modify: `server/src/routes/ai.ts`

- [ ] **Step 1: Update PUT /ai/channel-settings/:channelId**

Find the PUT handler for channel settings. Add `auto_reply_enabled`, `auto_reply_message`, and `auto_reply_trigger` to the accepted fields and the update object. Follow the same pattern as existing fields.

Validate:
- `auto_reply_trigger` must be 'outside_hours' or 'all_unavailable' if provided
- `auto_reply_message` should be a string, max 1000 chars

Also update the GET endpoint to return these fields (they should already be returned if using `select('*')`, but verify).

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/ai.ts
git commit -m "feat: accept auto-reply settings in channel settings API"
```

---

### Task 5: Create AutoReplySection UI component

**Files:**
- Create: `client/src/components/settings/sections/AutoReplySection.tsx`

- [ ] **Step 1: Build the component**

Props:
```typescript
interface AutoReplySectionProps {
  enabled: boolean;
  message: string | null;
  trigger: 'outside_hours' | 'all_unavailable';
  onSave: (updates: {
    auto_reply_enabled: boolean;
    auto_reply_message: string | null;
    auto_reply_trigger: string;
  }) => Promise<void>;
}
```

Layout:
1. **Enable toggle** — Switch with label "Auto-reply when unavailable"
2. **Trigger selector** (only when enabled) — Two radio-style buttons:
   - "Outside business hours" — description: "Sends when your team is off the clock"
   - "When all members are away" — description: "Sends when everyone assigned is set to Away"
3. **Message textarea** (only when enabled) — placeholder: "Thanks for reaching out! We'll get back to you as soon as possible."
4. **Note** — "Auto-reply only sends on the first message of a new conversation."
5. **Save button** — only when changes detected

Follow the same pattern as `ScheduleSection.tsx` (SectionCard wrapper, draft state, change detection).

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/sections/AutoReplySection.tsx
git commit -m "feat: add AutoReplySection UI component"
```

---

### Task 6: Integrate AutoReplySection into ChannelDetailView

**Files:**
- Modify: `client/src/components/settings/ChannelDetailView.tsx`

- [ ] **Step 1: Show AutoReplySection when AI is off**

In the AI Agent tab (lines 551-828), after the AI toggle but BEFORE the response mode section, add:

```tsx
{!channelSettings?.is_enabled && (
  <AutoReplySection
    enabled={channelSettings?.auto_reply_enabled ?? false}
    message={channelSettings?.auto_reply_message ?? null}
    trigger={channelSettings?.auto_reply_trigger ?? 'outside_hours'}
    onSave={handleSaveAutoReply}
  />
)}
```

Add the save handler:
```typescript
const handleSaveAutoReply = async (updates: {
  auto_reply_enabled: boolean;
  auto_reply_message: string | null;
  auto_reply_trigger: string;
}) => {
  await saveChannelSettings(updates);
  // saveChannelSettings already exists as the generic PUT handler
};
```

The auto-reply section should only be visible when `is_enabled === false` (AI is off). When AI is on, the AI schedule handles response timing.

- [ ] **Step 2: Update useChannelAgent hook**

Ensure `useChannelAgent.ts` includes the new auto-reply fields in its `ChannelAgentSettings` interface.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/ChannelDetailView.tsx client/src/hooks/useChannelAgent.ts
git commit -m "feat: show auto-reply config when AI is off on channel detail"
```

---

## Sub-Plan B: AI Schedule — New Modes

### Overview

Add two new schedule modes to the existing three:

| Mode | Behavior |
|------|----------|
| `always_on` | AI responds 24/7 (existing) |
| `business_hours` | AI responds during company business hours (existing) |
| `custom` | AI responds on a custom per-channel schedule (existing) |
| **`when_away`** | **AI responds only when ALL team members are Away** |
| **`outside_hours`** | **AI responds only OUTSIDE business hours (humans handle daytime, AI handles nights/weekends)** |

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/056_ai_schedule_new_modes.sql` | Update CHECK constraint on schedule_mode |
| Modify | `server/src/services/ai.ts` | Evaluate new modes in `shouldAIRespond()` |
| Modify | `client/src/components/settings/sections/ScheduleSection.tsx` | Add new mode buttons to UI |
| Modify | `client/src/hooks/useChannelAgent.ts` | Update ScheduleMode type |
| Modify | `client/src/hooks/useCompanyAI.ts` | Update ScheduleMode type |

---

### Task 7: Database migration for new schedule modes

**Files:**
- Create: `supabase/migrations/056_ai_schedule_new_modes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Expand schedule_mode CHECK constraint to include new modes
-- Drop old constraint and add new one
ALTER TABLE channel_agent_settings
  DROP CONSTRAINT IF EXISTS channel_agent_settings_schedule_mode_check;

ALTER TABLE channel_agent_settings
  ADD CONSTRAINT channel_agent_settings_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom', 'when_away', 'outside_hours'));

-- Also update the company_ai_profiles table (if it has the same constraint)
ALTER TABLE company_ai_profiles
  DROP CONSTRAINT IF EXISTS company_ai_profiles_schedule_mode_check;

ALTER TABLE company_ai_profiles
  ADD CONSTRAINT company_ai_profiles_schedule_mode_check
  CHECK (schedule_mode IN ('always_on', 'business_hours', 'custom', 'when_away', 'outside_hours'));
```

**Note:** Check the exact constraint names by querying `pg_constraint` first. The constraint names may differ.

- [ ] **Step 2: Run migration and verify**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/056_ai_schedule_new_modes.sql
git commit -m "feat: add when_away and outside_hours schedule modes"
```

---

### Task 8: Evaluate new modes in shouldAIRespond()

**Files:**
- Modify: `server/src/services/ai.ts` (lines 351-410)

- [ ] **Step 1: Add when_away mode evaluation**

In the schedule check section (after the holiday check, around line 395), add a new branch:

```typescript
if (scheduleMode === 'when_away') {
  // AI responds only when ALL team members are Away
  // Fetch auto-assign members for this channel (or company-wide rule)
  const { data: rule } = await supabaseAdmin
    .from('auto_assign_rules')
    .select('id')
    .eq('company_id', companyId)
    .eq('channel_id', channelSettings.channel_id)
    .eq('is_active', true)
    .single();

  const { data: companyRule } = !rule ? await supabaseAdmin
    .from('auto_assign_rules')
    .select('id')
    .eq('company_id', companyId)
    .is('channel_id', null)
    .eq('is_active', true)
    .single() : { data: null };

  const ruleId = rule?.id || companyRule?.id;

  if (ruleId) {
    const { data: members } = await supabaseAdmin
      .from('auto_assign_members')
      .select('is_available')
      .eq('rule_id', ruleId);

    if (members && members.length > 0) {
      const someoneAvailable = members.some(m => m.is_available);
      if (someoneAvailable) {
        // Someone is available → AI should NOT respond
        return { action: 'skip' };
      }
    }
  }
  // Everyone is Away (or no rule/members) → AI responds
  // Fall through to response logic
}
```

- [ ] **Step 2: Add outside_hours mode evaluation**

```typescript
if (scheduleMode === 'outside_hours') {
  // AI responds only OUTSIDE business hours (inverse of business_hours)
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('timezone, business_hours')
    .eq('id', companyId)
    .single();

  const timezone = company?.timezone || 'UTC';
  const schedule = company?.business_hours as BusinessHours | null;

  if (schedule) {
    if (isWithinSchedule(schedule, timezone)) {
      // WITHIN business hours → AI should NOT respond (humans handle it)
      return { action: 'skip' };
    }
    // OUTSIDE business hours → AI responds (fall through)
  }
  // No business hours configured → AI responds always (fall through)
}
```

**Note:** The `outside_hours` mode is the inverse of `business_hours`. In `business_hours` mode, AI responds DURING hours. In `outside_hours` mode, AI responds OUTSIDE hours.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/ai.ts
git commit -m "feat: evaluate when_away and outside_hours schedule modes"
```

---

### Task 9: Update ScheduleSection UI with new modes

**Files:**
- Modify: `client/src/components/settings/sections/ScheduleSection.tsx`
- Modify: `client/src/hooks/useChannelAgent.ts` (ScheduleMode type)
- Modify: `client/src/hooks/useCompanyAI.ts` (ScheduleMode type)

- [ ] **Step 1: Update ScheduleMode type**

In both hooks, update the type:
```typescript
export type ScheduleMode = 'always_on' | 'business_hours' | 'custom' | 'when_away' | 'outside_hours';
```

- [ ] **Step 2: Add new mode buttons to ScheduleSection.tsx**

Add two new `OptionButton` entries after "Custom Schedule" (around line 189):

```tsx
<OptionButton
  icon={<Clock className="h-4 w-4" />}
  label="When Team is Away"
  description="AI activates when all team members are set to Away"
  selected={draftMode === 'when_away'}
  onClick={() => setDraftMode('when_away')}
/>
<OptionButton
  icon={<Moon className="h-4 w-4" />}
  label="Outside Business Hours"
  description="AI covers nights and weekends — humans handle business hours"
  selected={draftMode === 'outside_hours'}
  onClick={() => setDraftMode('outside_hours')}
/>
```

Import `Moon` from `lucide-react`. `Clock` may already be imported.

The outside_hours_message textarea should show for ALL modes except `always_on` (currently shows for non-always_on, which already covers the new modes).

The BusinessHoursEditor should only show for `custom` mode (already the case).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/settings/sections/ScheduleSection.tsx client/src/hooks/useChannelAgent.ts client/src/hooks/useCompanyAI.ts
git commit -m "feat: add When Away and Outside Hours options to schedule UI"
```

---

## Sub-Plan C: Team Availability Dashboard

### Overview

A new section in Company Settings that shows all team members with their:
- Current availability status (Available / Away)
- Working hours schedule
- Whether their availability is auto-managed by hours
- AI assignment status (which channels have AI responding for them)

Read-only for all team members. Visible to anyone who can view company settings.

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/src/routes/teamAvailability.ts` | API endpoint returning enriched team availability data |
| Create | `client/src/components/settings/TeamAvailabilityDashboard.tsx` | Dashboard component |
| Modify | `client/src/pages/CompanySettingsPage.tsx` | Add dashboard section |
| Modify | `server/src/index.ts` | Register new route |

---

### Task 10: Create team availability API endpoint

**Files:**
- Create: `server/src/routes/teamAvailability.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// server/src/routes/teamAvailability.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// GET /api/team/availability — returns all team members with availability info
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch all company members with user details
    const { data: members } = await supabaseAdmin
      .from('company_members')
      .select('user_id, roles(name), users(full_name, email, avatar_url, timezone, personal_hours, hours_control_availability)')
      .eq('company_id', companyId);

    // Fetch availability from auto_assign_members
    const userIds = (members || []).map(m => m.user_id);
    const { data: assignMembers } = await supabaseAdmin
      .from('auto_assign_members')
      .select('user_id, is_available, rule_id, auto_assign_rules(channel_id)')
      .in('user_id', userIds);

    // Fetch company timezone for fallback
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('timezone')
      .eq('id', companyId)
      .single();

    const companyTimezone = company?.timezone || 'UTC';

    // Build response
    const result = (members || []).map(m => {
      const user = m.users as any;
      const role = m.roles as any;
      const userAssignments = (assignMembers || []).filter(a => a.user_id === m.user_id);

      // Aggregate availability: available if available in ALL rules (or no rules)
      const isAvailable = userAssignments.length === 0 || userAssignments.every(a => a.is_available);

      return {
        user_id: m.user_id,
        full_name: user?.full_name || user?.email || 'Unknown',
        email: user?.email,
        avatar_url: user?.avatar_url,
        role: role?.name || 'staff',
        timezone: user?.timezone || companyTimezone,
        personal_hours: user?.personal_hours,
        hours_controlled: user?.hours_control_availability ?? false,
        is_available: isAvailable,
      };
    });

    res.json({ members: result, company_timezone: companyTimezone });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register in index.ts**

```typescript
import teamAvailabilityRouter from './routes/teamAvailability.js';
app.use('/api/team/availability', teamAvailabilityRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/teamAvailability.ts server/src/index.ts
git commit -m "feat: add team availability API endpoint"
```

---

### Task 11: Create TeamAvailabilityDashboard component

**Files:**
- Create: `client/src/components/settings/TeamAvailabilityDashboard.tsx`

- [ ] **Step 1: Build the component**

Fetches from `GET /api/team/availability` and displays a list of team members.

Each member row shows:
- Avatar + name + role badge
- Status dot (green = Available, gray = Away)
- Timezone (if different from company)
- Working hours summary (e.g., "Mon-Fri 9:00-17:00") — derived from personal_hours
- Clock icon if hours-controlled (auto-managed)

Layout: Card with a simple table/list. Sorted by: available first, then alphabetical.

```typescript
interface TeamMemberAvailability {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  timezone: string;
  personal_hours: Record<string, unknown> | null;
  hours_controlled: boolean;
  is_available: boolean;
}
```

UI components to use:
- Card, CardHeader, CardTitle, CardDescription, CardContent
- Avatar, AvatarFallback, AvatarImage
- Badge (for role)
- Circle icon (for status dot)
- Clock icon (for hours-controlled indicator)

The working hours summary can be a simple helper:
```typescript
function summarizeHours(hours: BusinessHours | null): string {
  if (!hours) return 'No schedule set';
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;
  const enabled = days.filter(d => hours[d]?.enabled);
  if (enabled.length === 0) return 'No days enabled';
  // Format: "Mon-Fri 9:00-17:00" or "Mon, Wed, Fri 9:00-17:00"
  // Simplified: just show count of active days
  const firstDay = hours[enabled[0]];
  const slots = firstDay.slots?.length ? firstDay.slots : [{ open: firstDay.open, close: firstDay.close }];
  const timeStr = slots.map(s => `${s.open}-${s.close}`).join(', ');
  return `${enabled.length} days/week · ${timeStr}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/TeamAvailabilityDashboard.tsx
git commit -m "feat: add TeamAvailabilityDashboard component"
```

---

### Task 12: Add dashboard to CompanySettingsPage

**Files:**
- Modify: `client/src/pages/CompanySettingsPage.tsx`

- [ ] **Step 1: Import and render**

Add after the HolidayEditor section:

```tsx
import TeamAvailabilityDashboard from '@/components/settings/TeamAvailabilityDashboard';

// In the render, after <HolidayEditor scope="company" canEdit={canEdit} />:
<TeamAvailabilityDashboard />
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/CompanySettingsPage.tsx
git commit -m "feat: add team availability dashboard to company settings"
```

---

## Summary of All Changes

### Sub-Plan A: Channel Auto-Reply
| File | Change |
|------|--------|
| `supabase/migrations/055_channel_auto_reply.sql` | 3 new columns on channel_agent_settings |
| `server/src/services/autoReplyEvaluator.ts` | New — evaluates auto-reply conditions |
| `server/src/services/messageProcessor.ts` | Call evaluator on first session message |
| `server/src/routes/ai.ts` | Accept auto-reply fields in PUT |
| `client/src/components/settings/sections/AutoReplySection.tsx` | New — auto-reply config UI |
| `client/src/components/settings/ChannelDetailView.tsx` | Show AutoReplySection when AI is off |
| `client/src/hooks/useChannelAgent.ts` | Add auto-reply fields to interface |

### Sub-Plan B: AI Schedule New Modes
| File | Change |
|------|--------|
| `supabase/migrations/056_ai_schedule_new_modes.sql` | Expand CHECK constraint |
| `server/src/services/ai.ts` | Evaluate when_away and outside_hours |
| `client/src/components/settings/sections/ScheduleSection.tsx` | Two new mode buttons |
| `client/src/hooks/useChannelAgent.ts` | Update ScheduleMode type |
| `client/src/hooks/useCompanyAI.ts` | Update ScheduleMode type |

### Sub-Plan C: Team Availability Dashboard
| File | Change |
|------|--------|
| `server/src/routes/teamAvailability.ts` | New — team availability API |
| `client/src/components/settings/TeamAvailabilityDashboard.tsx` | New — dashboard component |
| `client/src/pages/CompanySettingsPage.tsx` | Render dashboard |
| `server/src/index.ts` | Register route |

### Dependency Order
Sub-Plans A, B, and C are independent — they can be built in any order or in parallel. Sub-Plan B is the smallest (3 tasks). Sub-Plan C is the most self-contained. Sub-Plan A is the most complex.
