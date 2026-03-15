# Labels & Quick Replies — Per-User/Per-Company Visibility

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow labels and quick replies (canned responses) to be created as personal (visible only to the creator) or company-wide (visible to all team members), with the ability to share personal items to the company.

**Architecture:** Add a `visibility` column (`'personal'` | `'company'`) to both `labels` and `canned_responses` tables. Personal items are filtered by `created_by = current_user`. Company items are visible to all members with the relevant permission. A share endpoint flips personal items to company-wide. The UI shows grouped sections ("Your Labels" / "Company Labels") in pickers, and a toggle when creating/editing.

**Tech Stack:** Supabase (Postgres migration, RLS), Express routes, React (shadcn UI components)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/050_label_canned_visibility.sql` | Migration: add `visibility` column, update constraints, update RLS |
| Modify | `server/src/routes/labels.ts` | Filter by visibility, accept visibility param, add share endpoint |
| Modify | `server/src/routes/cannedResponses.ts` | Same changes as labels |
| Modify | `client/src/components/settings/LabelsManager.tsx` | Add visibility toggle, show personal/company indicators |
| Modify | `client/src/components/settings/CannedResponsesManager.tsx` | Same changes as LabelsManager |
| Modify | `client/src/components/inbox/ConversationHeader.tsx` | Group labels by visibility in label picker |
| Modify | `client/src/hooks/useCannedResponses.ts` | Pass visibility flag through to API |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/050_label_canned_visibility.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Add visibility column to labels
ALTER TABLE labels
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'
  CHECK (visibility IN ('personal', 'company'));

-- Update unique constraint: allow same name if different visibility/creator
ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_company_id_name_key;
ALTER TABLE labels ADD CONSTRAINT labels_company_visibility_unique
  UNIQUE (company_id, created_by, name);

-- Add visibility column to canned_responses
ALTER TABLE canned_responses
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'company'
  CHECK (visibility IN ('personal', 'company'));

-- Add unique constraint for canned_responses personal items
-- (company-wide: unique by company+title, personal: unique by creator+title)
ALTER TABLE canned_responses ADD CONSTRAINT canned_responses_visibility_unique
  UNIQUE (company_id, created_by, title);

-- Update RLS policies for labels
DROP POLICY IF EXISTS labels_select ON labels;
CREATE POLICY labels_select ON labels FOR SELECT USING (
  company_id = public.get_user_company_id()
  AND (
    visibility = 'company'
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS labels_insert ON labels;
CREATE POLICY labels_insert ON labels FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id()
  AND public.has_permission('labels', 'create')
);

DROP POLICY IF EXISTS labels_update ON labels;
CREATE POLICY labels_update ON labels FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('labels', 'edit'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS labels_delete ON labels;
CREATE POLICY labels_delete ON labels FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('labels', 'delete'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

-- Update RLS policies for canned_responses
DROP POLICY IF EXISTS canned_responses_select ON canned_responses;
CREATE POLICY canned_responses_select ON canned_responses FOR SELECT USING (
  company_id = public.get_user_company_id()
  AND is_deleted = false
  AND (
    visibility = 'company'
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS canned_responses_update ON canned_responses;
CREATE POLICY canned_responses_update ON canned_responses FOR UPDATE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('canned_responses', 'edit'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS canned_responses_delete ON canned_responses;
CREATE POLICY canned_responses_delete ON canned_responses FOR DELETE USING (
  company_id = public.get_user_company_id()
  AND (
    (visibility = 'company' AND public.has_permission('canned_responses', 'delete'))
    OR (visibility = 'personal' AND created_by = auth.uid())
  )
);

-- Index for efficient filtering
CREATE INDEX idx_labels_visibility ON labels (company_id, visibility);
CREATE INDEX idx_canned_responses_visibility ON canned_responses (company_id, visibility) WHERE is_deleted = false;
```

- [ ] **Step 2: Verify migration syntax**

Run: `cat supabase/migrations/050_label_canned_visibility.sql` — confirm no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/050_label_canned_visibility.sql
git commit -m "feat: add visibility column to labels and canned_responses"
```

---

## Task 2: Labels API — Visibility Filtering and Share Endpoint

**Files:**
- Modify: `server/src/routes/labels.ts`

- [ ] **Step 1: Update GET /labels to return visibility and filter personal items**

In the GET handler, the current query fetches all labels by company_id. Update it to:
- Add `.or(`visibility.eq.company,created_by.eq.${req.userId}`)` to the query
- Include `visibility` and `created_by` in the select

The query should become:
```typescript
const { data, error } = await supabaseAdmin
  .from('labels')
  .select('*')
  .eq('company_id', companyId)
  .or(`visibility.eq.company,created_by.eq.${req.userId}`)
  .order('name');
```

- [ ] **Step 2: Update POST /labels to accept visibility parameter**

In the POST handler, add `visibility` to the destructured body fields. Default to `'company'` if not provided. Include it in the insert:

```typescript
const { name, color, visibility = 'company' } = req.body;

// Validate visibility
if (!['personal', 'company'].includes(visibility)) {
  res.status(400).json({ error: 'visibility must be "personal" or "company"' });
  return;
}
```

Add `visibility` to the insert object and set `created_by: req.userId`.

- [ ] **Step 3: Update PUT /labels/:labelId to enforce ownership for personal labels**

Before updating, fetch the label and check:
- If `visibility === 'personal'` and `created_by !== req.userId`, return 403
- If `visibility === 'company'`, normal permission check applies (already handled by middleware)

- [ ] **Step 4: Add PATCH /labels/:labelId/share endpoint**

```typescript
// Share a personal label to company
router.patch('/:labelId/share', requirePermission('labels', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { labelId } = req.params;

    // Verify label exists and belongs to current user
    const { data: label } = await supabaseAdmin
      .from('labels')
      .select('*')
      .eq('id', labelId)
      .eq('company_id', companyId)
      .eq('created_by', req.userId)
      .eq('visibility', 'personal')
      .single();

    if (!label) {
      res.status(404).json({ error: 'Personal label not found' });
      return;
    }

    // Check for name conflict with existing company labels
    const { data: existing } = await supabaseAdmin
      .from('labels')
      .select('id')
      .eq('company_id', companyId)
      .eq('name', label.name)
      .eq('visibility', 'company')
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'A company label with this name already exists' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('labels')
      .update({ visibility: 'company', updated_at: new Date().toISOString() })
      .eq('id', labelId)
      .select()
      .single();

    if (error) throw error;
    res.json({ label: data });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/labels.ts
git commit -m "feat: add visibility filtering and share endpoint to labels API"
```

---

## Task 3: Canned Responses API — Same Visibility Changes

**Files:**
- Modify: `server/src/routes/cannedResponses.ts`

- [ ] **Step 1: Update GET to filter by visibility (same pattern as labels)**

Add `.or(`visibility.eq.company,created_by.eq.${req.userId}`)` to the existing query.

- [ ] **Step 2: Update POST to accept visibility parameter**

Same pattern as labels — destructure `visibility`, validate, include in insert.

- [ ] **Step 3: Update PUT to enforce ownership for personal items**

Same pattern as labels — check `created_by` before allowing edit of personal items.

- [ ] **Step 4: Add PATCH /:id/share endpoint**

Same pattern as labels share endpoint, but check for title conflicts instead of name.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/cannedResponses.ts
git commit -m "feat: add visibility filtering and share to canned responses API"
```

---

## Task 4: Labels Manager UI — Visibility Toggle and Indicators

**Files:**
- Modify: `client/src/components/settings/LabelsManager.tsx`

- [ ] **Step 1: Add visibility to form state**

Add `visibility: 'company' as 'personal' | 'company'` to the form state object. Add it to `resetForm`, `openCreate`, and `openEdit`.

- [ ] **Step 2: Add visibility toggle in the create/edit dialog**

After the color picker section, add a toggle:

```tsx
<div>
  <Label>Visibility</Label>
  <div className="mt-2 flex gap-2">
    <Button
      type="button"
      variant={form.visibility === 'personal' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm({ ...form, visibility: 'personal' })}
    >
      Just me
    </Button>
    <Button
      type="button"
      variant={form.visibility === 'company' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm({ ...form, visibility: 'company' })}
    >
      Everyone
    </Button>
  </div>
</div>
```

- [ ] **Step 3: Pass visibility in create/update API calls**

Update `handleSubmit` to include `visibility: form.visibility` in the POST/PUT payload.

- [ ] **Step 4: Show visibility indicator in the label list**

Next to each label name, show a badge:
- Personal labels: show `<Badge variant="outline" className="text-[10px]">Personal</Badge>`
- Company labels shared by current user: show nothing (default)
- Company labels: show nothing

- [ ] **Step 5: Add share button for personal labels**

For labels where `visibility === 'personal'` and `created_by` matches the current user, add a share button:

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-7 w-7"
  title="Share with company"
  onClick={() => handleShare(label.id)}
>
  <Share2 className="h-3.5 w-3.5" />
</Button>
```

The `handleShare` function calls `api.patch(`/labels/${labelId}/share`)` and refreshes.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/LabelsManager.tsx
git commit -m "feat: add visibility toggle and share to labels manager"
```

---

## Task 5: Canned Responses Manager UI — Same Visibility Changes

**Files:**
- Modify: `client/src/components/settings/CannedResponsesManager.tsx`

- [ ] **Step 1-5: Mirror all changes from Task 4 for canned responses**

Same pattern: add visibility to form state, add toggle, pass in API calls, show indicator, add share button. Use `api.patch(`/canned-responses/${id}/share`)`.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/CannedResponsesManager.tsx
git commit -m "feat: add visibility toggle and share to canned responses manager"
```

---

## Task 6: Label Picker — Group by Visibility

**Files:**
- Modify: `client/src/components/inbox/ConversationHeader.tsx` (the label picker dropdown)

- [ ] **Step 1: Group labels in the picker**

In the label picker section of `ConversationHeader.tsx`, split labels into two groups:
- `personalLabels = labels.filter(l => l.visibility === 'personal')`
- `companyLabels = labels.filter(l => l.visibility === 'company')`

Render with section headers:
```tsx
{personalLabels.length > 0 && (
  <>
    <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Your Labels</div>
    {personalLabels.map(label => /* existing label render */)}
  </>
)}
{companyLabels.length > 0 && (
  <>
    <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Company Labels</div>
    {companyLabels.map(label => /* existing label render */)}
  </>
)}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/inbox/ConversationHeader.tsx
git commit -m "feat: group labels by visibility in conversation label picker"
```

---

## Task 7: Quick Reply Picker — Group by Visibility

**Files:**
- Modify: `client/src/hooks/useCannedResponses.ts`
- Check: the message input component that renders the `/` command picker

- [ ] **Step 1: Ensure the hook passes through visibility data**

The `useCannedResponses` hook should already return all fields from the API. Verify that the `CannedResponse` type includes `visibility`.

- [ ] **Step 2: Group quick replies in the `/` picker**

In the component that renders the canned response picker (triggered by `/`), group by visibility using the same "Your Replies" / "Company Replies" section headers pattern from Task 6.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useCannedResponses.ts client/src/components/inbox/
git commit -m "feat: group quick replies by visibility in picker"
```

---

## Task 8: Build & Verify

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: No TypeScript errors, successful build.

- [ ] **Step 2: Manual testing checklist**

- Create a personal label → verify only you see it
- Create a company label → verify all team members see it
- Share a personal label → verify it becomes company-wide with "Shared by [name]" context
- Same for canned responses
- Label picker in conversation → verify grouped sections
- Quick reply picker (`/` command) → verify grouped sections

- [ ] **Step 3: Final commit if any fixes needed**
