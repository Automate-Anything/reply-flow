# Personal Hours & Availability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user timezone, personal working hours, and auto-managed availability — plus company/user-level holiday exceptions — so that user availability is automatically controlled by schedule while allowing manual override.

**Architecture:** Users get a `timezone` column (nullable, falls back to company timezone) and a `personal_hours` JSONB (same `BusinessHours` shape already used for company hours). A server-side cron job evaluates each user's schedule every minute and flips `is_available` on their `auto_assign_members` rows. Manual overrides are respected until the next scheduled day start. Company holidays block company-level features (AI schedule); user holidays block user availability. Both use a shared `holidays` table with a `scope` discriminator.

**Tech Stack:** PostgreSQL (Supabase), Express.js, React + Tailwind + shadcn/ui, node-cron (already used for message scheduler)

---

## File Structure

### Database
- **Create:** `supabase/migrations/054_personal_hours_and_holidays.sql` — adds `users.timezone`, `users.personal_hours`, `users.hours_control_availability`, `users.availability_override_until`, and `holidays` table

### Server
- **Create:** `server/src/services/availabilityScheduler.ts` — cron job that evaluates personal hours and flips availability
- **Create:** `server/src/routes/holidays.ts` — CRUD endpoints for company and user holidays
- **Modify:** `server/src/routes/me.ts` — accept `timezone`, `personal_hours`, `hours_control_availability` in PUT /api/me
- **Modify:** `server/src/routes/autoAssign.ts` — record manual override timestamp when user toggles availability
- **Modify:** `server/src/index.ts` — register holidays routes and start availability scheduler
- **Modify:** `server/src/services/ai.ts` — check company holidays in `isWithinSchedule()`

### Client
- **Create:** `client/src/components/settings/PersonalHoursSection.tsx` — timezone picker + working hours editor + hours-control toggle for profile page
- **Create:** `client/src/components/settings/HolidayEditor.tsx` — reusable holiday list editor (add/edit/delete holidays with date, name, recurring flag)
- **Modify:** `client/src/pages/ProfileSettingsPage.tsx` — add "Availability & Hours" tab with PersonalHoursSection + user holidays
- **Modify:** `client/src/pages/CompanySettingsPage.tsx` — add company holidays section
- **Modify:** `client/src/components/layout/Header.tsx` — show clock icon or indicator when availability is hours-controlled

---

## Chunk 1: Database Schema

### Task 1: Create migration for user columns and holidays table

**Files:**
- Create: `supabase/migrations/054_personal_hours_and_holidays.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Personal hours & timezone on users
ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN personal_hours JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN hours_control_availability BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN availability_override_until TIMESTAMPTZ DEFAULT NULL;

-- Comments for clarity
COMMENT ON COLUMN users.timezone IS 'IANA timezone override. NULL = use company timezone.';
COMMENT ON COLUMN users.personal_hours IS 'Weekly working hours schedule (same shape as companies.business_hours). NULL = no personal schedule.';
COMMENT ON COLUMN users.hours_control_availability IS 'When true, availability is auto-managed by personal_hours schedule.';
COMMENT ON COLUMN users.availability_override_until IS 'When set, manual availability override is active until this timestamp. Scheduler ignores the user until then.';

-- Holidays table (shared for company and user scope)
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('company', 'user')),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holidays_user_scope_check CHECK (
    (scope = 'company' AND user_id IS NULL) OR
    (scope = 'user' AND user_id IS NOT NULL)
  )
);

CREATE INDEX idx_holidays_company ON holidays (company_id);
CREATE INDEX idx_holidays_user ON holidays (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_holidays_date ON holidays (company_id, date);

-- RLS
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Everyone in the company can see all holidays (company + user)
CREATE POLICY holidays_select ON holidays FOR SELECT USING (
  company_id = public.get_user_company_id()
);

-- Company holidays: only users with company_settings edit permission
CREATE POLICY holidays_company_insert ON holidays FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR (scope = 'user' AND user_id = auth.uid())
  )
);

CREATE POLICY holidays_company_update ON holidays FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR (scope = 'user' AND user_id = auth.uid())
  )
);

CREATE POLICY holidays_company_delete ON holidays FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (scope = 'company' AND public.has_permission('company_settings', 'edit'))
    OR (scope = 'user' AND user_id = auth.uid())
  )
);
```

- [ ] **Step 2: Run migration against Supabase**

```bash
source server/.env && pg_dump_path=$(which pg_dump || echo "$HOME/scoop/apps/postgresql/current/bin/pg_dump.exe") && psql "$SUPABASE_DB_URL" -f supabase/migrations/054_personal_hours_and_holidays.sql
```

Expected: All statements succeed with no errors.

- [ ] **Step 3: Verify schema**

```bash
source server/.env && psql "$SUPABASE_DB_URL" -c "\d users" | head -30
source server/.env && psql "$SUPABASE_DB_URL" -c "\d holidays"
```

Expected: New columns visible on `users`, `holidays` table created.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/054_personal_hours_and_holidays.sql
git commit -m "feat: add user timezone, personal hours, and holidays table"
```

---

## Chunk 2: Server — User Profile Updates (timezone, personal hours)

### Task 2: Extend PUT /api/me to accept new fields

**Files:**
- Modify: `server/src/routes/me.ts` (lines 149-183)

- [ ] **Step 1: Update PUT /api/me handler**

Add `timezone`, `personal_hours`, and `hours_control_availability` to the accepted body fields. The handler currently only accepts `full_name`. Extend it:

```typescript
// In PUT /api/me handler, after existing full_name validation:

const { full_name, timezone, personal_hours, hours_control_availability } = req.body;

// Build update object
const updates: Record<string, unknown> = {};

if (full_name !== undefined) {
  const trimmed = (full_name || '').trim();
  if (!trimmed || trimmed.length > 100) {
    res.status(400).json({ error: 'Name must be 1–100 characters' });
    return;
  }
  updates.full_name = trimmed;
}

if (timezone !== undefined) {
  // Validate IANA timezone
  if (timezone !== null) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      res.status(400).json({ error: 'Invalid timezone' });
      return;
    }
  }
  updates.timezone = timezone; // null clears override → falls back to company
}

if (personal_hours !== undefined) {
  updates.personal_hours = personal_hours; // null clears personal hours
}

if (hours_control_availability !== undefined) {
  updates.hours_control_availability = !!hours_control_availability;
}
```

- [ ] **Step 2: Update GET /api/me to return new fields**

In the profile select query, ensure `timezone`, `personal_hours`, `hours_control_availability` are included in the returned profile object.

- [ ] **Step 3: Test manually with curl**

```bash
curl -X PUT http://localhost:3001/api/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"timezone": "America/New_York"}'
```

Expected: 200 with updated profile containing timezone.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/me.ts
git commit -m "feat: accept timezone, personal_hours in PUT /api/me"
```

---

### Task 3: Record manual override in auto-assign availability toggle

**Files:**
- Modify: `server/src/routes/autoAssign.ts` (lines 174-187)

- [ ] **Step 1: Update PATCH /my-availability to set override timestamp**

When a user manually toggles availability, set `availability_override_until` on the `users` table to the start of the next day in their timezone. This tells the scheduler to skip them until then.

```typescript
// In PATCH /my-availability handler, after updating auto_assign_members:

// Fetch user's effective timezone
const { data: userData } = await supabaseAdmin
  .from('users')
  .select('timezone, company_id')
  .eq('id', req.userId)
  .single();

const { data: companyData } = await supabaseAdmin
  .from('companies')
  .select('timezone')
  .eq('id', userData.company_id)
  .single();

const tz = userData.timezone || companyData?.timezone || 'UTC';

// Calculate start of next day in user's timezone
const now = new Date();
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
const todayStr = formatter.format(now); // "YYYY-MM-DD"
const tomorrow = new Date(todayStr + 'T00:00:00');
tomorrow.setDate(tomorrow.getDate() + 1);
// Convert back: we need tomorrow 00:00 in the user's TZ as a UTC timestamp
// Use a helper or approximate: find the offset
const overrideUntil = getStartOfNextDayInTZ(tz);

await supabaseAdmin
  .from('users')
  .update({ availability_override_until: overrideUntil })
  .eq('id', req.userId);
```

- [ ] **Step 2: Add `getStartOfNextDayInTZ()` helper**

Create a utility function that computes the UTC timestamp for midnight of the next day in a given IANA timezone. This is needed because JS `Date` doesn't natively handle TZ-aware date math.

```typescript
// In a shared utils or inline:
function getStartOfNextDayInTZ(tz: string): string {
  const now = new Date();
  // Get today's date parts in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);

  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);

  // Tomorrow at 00:00 in the target timezone
  // We construct an ISO string and use the TZ offset to convert to UTC
  // Approximate: add 1 day to current date, set to midnight
  const tomorrowLocal = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));

  // Adjust for timezone offset: get offset by comparing formatted time vs UTC
  const utcHour = now.getUTCHours();
  const localHourStr = parts.find(p => p.type === 'hour')!.value;
  const localHour = parseInt(localHourStr);
  const offsetHours = localHour - utcHour;

  tomorrowLocal.setUTCHours(tomorrowLocal.getUTCHours() - offsetHours);
  return tomorrowLocal.toISOString();
}
```

**Note:** This is an approximation. For production accuracy across DST boundaries, consider using a library like `date-fns-tz` or `luxon`. Check if either is already a dependency.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/autoAssign.ts
git commit -m "feat: record manual availability override until next day"
```

---

## Chunk 3: Server — Availability Scheduler

### Task 4: Create the availability scheduler service

**Files:**
- Create: `server/src/services/availabilityScheduler.ts`
- Modify: `server/src/index.ts` — import and start the scheduler

- [ ] **Step 1: Check if node-cron or similar is already a dependency**

```bash
grep -E "node-cron|cron" server/package.json
```

Also check how the existing message scheduler works (it "polls every 30s" per the server startup log). Follow the same pattern.

- [ ] **Step 2: Create the scheduler service**

The scheduler runs every 60 seconds. For each user with `hours_control_availability = true`:

1. Skip if `availability_override_until` is in the future (manual override active)
2. Get effective timezone (user.timezone ?? company.timezone ?? 'UTC')
3. Check if today is a user holiday or company holiday → if yes, mark unavailable
4. Otherwise, evaluate `personal_hours` against current time using `isWithinSchedule()`
5. Update `auto_assign_members.is_available` for all their memberships

```typescript
// server/src/services/availabilityScheduler.ts

import { supabaseAdmin } from '../lib/supabase';
import { isWithinSchedule } from './ai';

// Re-export isWithinSchedule or extract to shared utils if not already exported

interface UserScheduleRow {
  id: string;
  timezone: string | null;
  personal_hours: Record<string, unknown> | null;
  hours_control_availability: boolean;
  availability_override_until: string | null;
  company_id: string;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startAvailabilityScheduler() {
  console.log('Availability scheduler started (polling every 60s)');
  intervalId = setInterval(evaluateAvailability, 60_000);
  // Run once immediately on startup
  evaluateAvailability();
}

export function stopAvailabilityScheduler() {
  if (intervalId) clearInterval(intervalId);
}

async function evaluateAvailability() {
  try {
    // Fetch all users with hours-controlled availability
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, timezone, personal_hours, hours_control_availability, availability_override_until, company_id')
      .eq('hours_control_availability', true)
      .not('personal_hours', 'is', null);

    if (error || !users?.length) return;

    // Batch fetch company timezones
    const companyIds = [...new Set(users.map(u => u.company_id))];
    const { data: companies } = await supabaseAdmin
      .from('companies')
      .select('id, timezone')
      .in('id', companyIds);

    const companyTzMap = new Map(companies?.map(c => [c.id, c.timezone]) || []);

    // Fetch today's holidays (company + user)
    const todayStr = new Date().toISOString().slice(0, 10); // UTC date
    const { data: holidays } = await supabaseAdmin
      .from('holidays')
      .select('company_id, user_id, scope, date, recurring')
      .in('company_id', companyIds);

    const now = new Date();

    for (const user of users) {
      try {
        // Skip if manual override is active
        if (user.availability_override_until) {
          const overrideUntil = new Date(user.availability_override_until);
          if (now < overrideUntil) continue;
          // Override expired — clear it
          await supabaseAdmin
            .from('users')
            .update({ availability_override_until: null })
            .eq('id', user.id);
        }

        const tz = user.timezone || companyTzMap.get(user.company_id) || 'UTC';

        // Check if today is a holiday for this user
        const isHoliday = checkIsHoliday(holidays || [], user.id, user.company_id, tz, now);

        let shouldBeAvailable: boolean;
        if (isHoliday) {
          shouldBeAvailable = false;
        } else {
          shouldBeAvailable = isWithinSchedule(user.personal_hours as any, tz);
        }

        // Update all auto_assign_members rows for this user
        await supabaseAdmin
          .from('auto_assign_members')
          .update({ is_available: shouldBeAvailable })
          .eq('user_id', user.id);

      } catch (err) {
        console.error(`Availability scheduler error for user ${user.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Availability scheduler error:', err);
  }
}

function checkIsHoliday(
  holidays: Array<{ company_id: string; user_id: string | null; scope: string; date: string; recurring: boolean }>,
  userId: string,
  companyId: string,
  tz: string,
  now: Date
): boolean {
  // Get today's date in the user's timezone
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // "YYYY-MM-DD"
  const todayDate = parts; // e.g. "2026-03-15"
  const todayMMDD = todayDate.slice(5); // "03-15" for recurring match

  for (const h of holidays) {
    // Must be for this company
    if (h.company_id !== companyId) continue;
    // Must be for this user (user scope) or company-wide
    if (h.scope === 'user' && h.user_id !== userId) continue;

    if (h.recurring) {
      // Match month-day only
      const holidayMMDD = h.date.slice(5);
      if (holidayMMDD === todayMMDD) return true;
    } else {
      if (h.date === todayDate) return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: Export `isWithinSchedule` from ai.ts**

Currently `isWithinSchedule` is a local function in `server/src/services/ai.ts`. Add `export` keyword so the scheduler can import it. Alternatively, extract schedule-checking utilities into a shared file like `server/src/services/scheduleUtils.ts`.

- [ ] **Step 4: Register scheduler in index.ts**

```typescript
import { startAvailabilityScheduler } from './services/availabilityScheduler';

// After server starts listening:
startAvailabilityScheduler();
```

- [ ] **Step 5: Commit**

```bash
git add server/src/services/availabilityScheduler.ts server/src/services/ai.ts server/src/index.ts
git commit -m "feat: add availability scheduler that auto-manages user availability from personal hours"
```

---

## Chunk 4: Server — Holidays CRUD Endpoints

### Task 5: Create holidays route

**Files:**
- Create: `server/src/routes/holidays.ts`
- Modify: `server/src/index.ts` — register route

- [ ] **Step 1: Create the holidays router**

```typescript
// server/src/routes/holidays.ts
import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// GET /api/holidays?scope=company — list company holidays
// GET /api/holidays?scope=user — list current user's personal holidays
// GET /api/holidays — list all (company + user's own)
router.get('/', async (req, res, next) => {
  try {
    const { scope } = req.query;
    let query = supabaseAdmin
      .from('holidays')
      .select('*')
      .eq('company_id', req.companyId)
      .order('date', { ascending: true });

    if (scope === 'company') {
      query = query.eq('scope', 'company');
    } else if (scope === 'user') {
      query = query.eq('scope', 'user').eq('user_id', req.userId);
    } else {
      // All: company holidays + this user's holidays
      query = query.or(`scope.eq.company,and(scope.eq.user,user_id.eq.${req.userId})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ holidays: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/holidays — create a holiday
router.post('/', async (req, res, next) => {
  try {
    const { name, date, recurring, scope } = req.body;

    if (!name?.trim() || !date) {
      res.status(400).json({ error: 'Name and date are required' });
      return;
    }

    if (scope === 'company') {
      // Check permission for company holidays
      if (!req.hasPermission('company_settings', 'edit')) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .insert({
        company_id: req.companyId,
        user_id: scope === 'user' ? req.userId : null,
        scope: scope || 'user',
        name: name.trim(),
        date,
        recurring: !!recurring,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ holiday: data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/holidays/:id — update a holiday
router.put('/:id', async (req, res, next) => {
  try {
    const { name, date, recurring } = req.body;

    // Verify ownership/permission
    const { data: existing } = await supabaseAdmin
      .from('holidays')
      .select('scope, user_id')
      .eq('id', req.params.id)
      .eq('company_id', req.companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Holiday not found' });
      return;
    }

    if (existing.scope === 'company' && !req.hasPermission('company_settings', 'edit')) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    if (existing.scope === 'user' && existing.user_id !== req.userId) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (date !== undefined) updates.date = date;
    if (recurring !== undefined) updates.recurring = !!recurring;

    const { data, error } = await supabaseAdmin
      .from('holidays')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ holiday: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('holidays')
      .select('scope, user_id')
      .eq('id', req.params.id)
      .eq('company_id', req.companyId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Holiday not found' });
      return;
    }

    if (existing.scope === 'company' && !req.hasPermission('company_settings', 'edit')) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    if (existing.scope === 'user' && existing.user_id !== req.userId) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    await supabaseAdmin
      .from('holidays')
      .delete()
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: Register route in index.ts**

```typescript
import holidaysRouter from './routes/holidays';
// ...
app.use('/api/holidays', holidaysRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/holidays.ts server/src/index.ts
git commit -m "feat: add holidays CRUD endpoints"
```

---

## Chunk 5: Server — Company holidays in AI schedule

### Task 6: Check company holidays in isWithinSchedule

**Files:**
- Modify: `server/src/services/ai.ts`

- [ ] **Step 1: Add company holiday check before AI schedule evaluation**

In the section of `ai.ts` where the AI decides whether to respond (the function that calls `isWithinSchedule`), add a check: if today is a company holiday and the schedule mode is `business_hours`, treat it as outside hours.

Find the caller of `isWithinSchedule()` in `ai.ts` and add:

```typescript
// Before calling isWithinSchedule, check company holidays
const { data: companyHolidays } = await supabaseAdmin
  .from('holidays')
  .select('date, recurring')
  .eq('company_id', companyId)
  .eq('scope', 'company');

const todayInTz = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
const todayMMDD = todayInTz.slice(5);

const isCompanyHoliday = (companyHolidays || []).some(h =>
  h.recurring ? h.date.slice(5) === todayMMDD : h.date === todayInTz
);

if (isCompanyHoliday && scheduleMode === 'business_hours') {
  // Treat as outside hours
  return outsideHoursMessage || null;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/ai.ts
git commit -m "feat: respect company holidays in AI schedule evaluation"
```

---

## Chunk 6: Client — Personal Hours Section Component

### Task 7: Create PersonalHoursSection component

**Files:**
- Create: `client/src/components/settings/PersonalHoursSection.tsx`

- [ ] **Step 1: Build the component**

This component renders:
1. **Timezone picker** — searchable dropdown, shows "(Company default: X)" when no override set
2. **Hours-control toggle** — "Automatically manage my availability based on my working hours"
3. **Working hours editor** — reuses existing `BusinessHoursEditor` component, only visible when toggle is on
4. Save button

```typescript
// PersonalHoursSection.tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Clock, Globe } from 'lucide-react';
import BusinessHoursEditor, { getDefaultBusinessHours } from './BusinessHoursEditor';
import type { BusinessHours } from './BusinessHoursEditor';
import api from '@/lib/api';
// Timezone picker — reuse the same approach as CompanySettingsPage
// (Intl.supportedValuesOf('timeZone') with popover search)

interface PersonalHoursSectionProps {
  timezone: string | null;
  companyTimezone: string;
  personalHours: BusinessHours | null;
  hoursControlAvailability: boolean;
  onSave: (updates: {
    timezone?: string | null;
    personal_hours?: BusinessHours | null;
    hours_control_availability?: boolean;
  }) => Promise<void>;
}

export default function PersonalHoursSection({
  timezone,
  companyTimezone,
  personalHours,
  hoursControlAvailability,
  onSave,
}: PersonalHoursSectionProps) {
  const [tz, setTz] = useState(timezone);
  const [hours, setHours] = useState<BusinessHours>(personalHours || getDefaultBusinessHours());
  const [hoursControl, setHoursControl] = useState(hoursControlAvailability);
  const [saving, setSaving] = useState(false);

  // Detect changes
  const hasChanges = tz !== timezone
    || hoursControl !== hoursControlAvailability
    || JSON.stringify(hours) !== JSON.stringify(personalHours || getDefaultBusinessHours());

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        timezone: tz,
        personal_hours: hoursControl ? hours : personalHours,
        hours_control_availability: hoursControl,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Availability & Working Hours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Timezone picker */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Your Timezone
          </Label>
          <p className="text-xs text-muted-foreground">
            Overrides the company timezone ({companyTimezone}) for your personal schedule.
            Leave empty to use the company default.
          </p>
          {/* Timezone search/select popover — same pattern as CompanySettingsPage */}
        </div>

        {/* Hours control toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label>Auto-manage availability</Label>
            <p className="text-xs text-muted-foreground">
              Automatically set you as Available or Away based on your working hours below.
              You can still override manually — it resets the next day.
            </p>
          </div>
          <Switch checked={hoursControl} onCheckedChange={setHoursControl} />
        </div>

        {/* Working hours editor — only when toggle is on */}
        {hoursControl && (
          <div className="space-y-2">
            <Label>Working Hours</Label>
            <BusinessHoursEditor value={hours} onChange={setHours} />
          </div>
        )}

        {hasChanges && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/PersonalHoursSection.tsx
git commit -m "feat: add PersonalHoursSection component for profile settings"
```

---

### Task 8: Create HolidayEditor component

**Files:**
- Create: `client/src/components/settings/HolidayEditor.tsx`

- [ ] **Step 1: Build the component**

Reusable component that displays a list of holidays with add/edit/delete. Used in both profile (user holidays) and company settings (company holidays).

Props:
- `scope: 'company' | 'user'` — determines API calls and labels
- `canEdit: boolean` — controls whether add/edit/delete is available

Features:
- List of holidays sorted by date
- Each row: date, name, recurring badge, edit/delete buttons
- "Add Holiday" button opens inline form with: name input, date picker, recurring checkbox
- Recurring holidays show "Repeats yearly" badge

```typescript
// HolidayEditor.tsx
// Uses: api.get('/holidays?scope=...'), api.post('/holidays'), api.put('/holidays/:id'), api.delete('/holidays/:id')
// UI: Card with list, inline add/edit form
// Date picker: use existing date picker from shadcn/ui or a simple input[type=date]
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/settings/HolidayEditor.tsx
git commit -m "feat: add HolidayEditor component for managing holidays"
```

---

## Chunk 7: Client — Profile Settings Integration

### Task 9: Add Availability & Hours tab to ProfileSettingsPage

**Files:**
- Modify: `client/src/pages/ProfileSettingsPage.tsx`

- [ ] **Step 1: Add new tab**

The profile page currently has 3 tabs: General, Notifications, Security. Add a 4th tab: **"Availability"**.

Content of the Availability tab:
1. `PersonalHoursSection` — timezone + working hours + toggle
2. `HolidayEditor` with `scope="user"` — personal days off

Wire the save handler to call `PUT /api/me` with the updated fields.

- [ ] **Step 2: Fetch personal hours data from GET /api/me**

The profile fetch already calls `GET /api/me`. The response will now include `timezone`, `personal_hours`, `hours_control_availability`. Pass these to the components.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ProfileSettingsPage.tsx
git commit -m "feat: add Availability tab to profile settings with personal hours and holidays"
```

---

## Chunk 8: Client — Company Settings Integration

### Task 10: Add Company Holidays section to CompanySettingsPage

**Files:**
- Modify: `client/src/pages/CompanySettingsPage.tsx`

- [ ] **Step 1: Add HolidayEditor below BusinessHoursSettings**

Add the `HolidayEditor` component with `scope="company"` and `canEdit` based on the user's `company_settings:edit` permission. This goes right after the existing `BusinessHoursSettings` component.

```tsx
<HolidayEditor scope="company" canEdit={canEdit} />
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/CompanySettingsPage.tsx
git commit -m "feat: add company holidays section to company settings"
```

---

## Chunk 9: Client — Header Availability Indicator Enhancement

### Task 11: Show hours-controlled indicator on availability button

**Files:**
- Modify: `client/src/components/layout/Header.tsx`

- [ ] **Step 1: Fetch hours_control_availability from GET /api/me or availability endpoint**

Extend the existing availability fetch in the header to also check if the user has hours-controlled availability. If they do, show a small clock icon on the availability button to indicate it's auto-managed.

```tsx
// When hoursControlled is true, add a clock icon:
<Button variant="outline" size="sm" className={cn('h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium', ...)}>
  <Circle className={cn('h-2 w-2 fill-current', ...)} />
  {isAvailable ? 'Available' : 'Away'}
  {hoursControlled && <Clock className="h-3 w-3 text-muted-foreground" />}
</Button>
```

The tooltip should also update:
- When hours-controlled: "Your availability is managed by your working hours. Click to override until tomorrow."
- When manually set: "Click to toggle availability."

- [ ] **Step 2: Update PATCH /my-availability response to include override info**

Return `hours_controlled` and `override_until` in the availability response so the header can show appropriate state.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/layout/Header.tsx server/src/routes/autoAssign.ts
git commit -m "feat: show hours-controlled indicator on availability button"
```

---

## Chunk 10: Integration & Polish

### Task 12: End-to-end testing and edge cases

- [ ] **Step 1: Test the full flow**

1. Set personal hours (Mon-Fri 9-5) in Profile → Availability tab
2. Enable "Auto-manage availability"
3. Verify the scheduler flips availability based on schedule
4. Manually toggle to Away → verify override persists until next day
5. Add a user holiday for today → verify availability goes to Away
6. Add a company holiday → verify AI sends outside-hours message
7. Test timezone override: set user TZ different from company TZ, verify schedule evaluates in user's TZ

- [ ] **Step 2: Handle edge case — user not in any auto-assign rule**

If a user has `hours_control_availability = true` but no `auto_assign_members` rows, the scheduler has nothing to update. This is fine — the toggle still shows in the header and the personal hours are saved. When they're added to an auto-assign rule later, the scheduler will manage their availability.

The header's availability button should still work for display purposes even without auto-assign membership. Consider adding a `users.is_available` column as a denormalized flag that the header reads directly, separate from `auto_assign_members.is_available`.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: edge cases and polish for personal hours & availability"
```

---

## Summary of All Changes

### Database
| Change | Description |
|--------|-------------|
| `users.timezone` | IANA timezone override (nullable → falls back to company) |
| `users.personal_hours` | JSONB weekly schedule (same shape as `companies.business_hours`) |
| `users.hours_control_availability` | Boolean toggle for auto-managed availability |
| `users.availability_override_until` | Timestamp for manual override expiry |
| `holidays` table | Shared table for company + user holidays with date, name, recurring flag |

### Server
| File | Change |
|------|--------|
| `routes/me.ts` | Accept/return timezone, personal_hours, hours_control_availability |
| `routes/autoAssign.ts` | Set override timestamp on manual toggle |
| `routes/holidays.ts` | New — full CRUD for company and user holidays |
| `services/availabilityScheduler.ts` | New — cron job that evaluates personal hours and holidays |
| `services/ai.ts` | Check company holidays in AI schedule evaluation, export isWithinSchedule |
| `index.ts` | Register holidays routes, start availability scheduler |

### Client
| File | Change |
|------|--------|
| `components/settings/PersonalHoursSection.tsx` | New — timezone + hours editor + toggle |
| `components/settings/HolidayEditor.tsx` | New — reusable holiday list editor |
| `pages/ProfileSettingsPage.tsx` | Add "Availability" tab |
| `pages/CompanySettingsPage.tsx` | Add company holidays section |
| `components/layout/Header.tsx` | Show hours-controlled indicator |

### Hierarchy of Overrides

```
User Holiday (today) → User is AWAY (overrides everything for user)
  ↓ (no user holiday)
Manual Override (before expiry) → User stays at manually set state
  ↓ (no override)
Personal Hours schedule → Available if within schedule, Away if outside
  ↓ (no personal hours configured)
Always Available (current default behavior)

Company Holiday (today) → AI sends outside-hours message (does NOT affect user availability)
  ↓ (no company holiday)
AI Schedule (business_hours/custom) → Normal AI schedule evaluation
```
