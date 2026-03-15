# Contact Detail UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the contact detail panel's space usage, visual hierarchy, and information density by merging cards, hiding empty fields, and reordering the edit form.

**Architecture:** Pure frontend changes to two existing components. `ContactDetail.tsx` gets a unified card layout with conditional field rendering. `ContactForm.tsx` gets field reordering. No new files, no backend changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-15-contact-detail-ux-design.md`

---

## Chunk 1: ContactDetail.tsx Changes

### Task 1: Add "Created" date to header

**Files:**
- Modify: `client/src/components/contacts/ContactDetail.tsx:140-170`

- [ ] **Step 1: Add Calendar icon import**

In the existing Lucide import on line 6, add `Calendar`:

```typescript
import { ArrowLeft, Loader2, Pencil, Trash2, Phone, Mail, Building2, AlertTriangle, MapPin, MessageCircle, User, Hash, Clock, Brain, X, List, Calendar } from 'lucide-react';
```

- [ ] **Step 2: Add created date to header sub-line**

After the company `<span>` block (line 168), add:

```tsx
              <span className="text-muted-foreground/50">·</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Created {new Date(contact.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
```

This goes inside the existing `<div className="flex items-center gap-3 text-sm text-muted-foreground">` container, so it inherits the gap and muted styling.

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Open Contacts page, select a contact. Confirm "Created [date]" appears in the header sub-line after phone/email/company.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/contacts/ContactDetail.tsx
git commit -m "feat: add created date to contact detail header"
```

---

### Task 2: Remove tags and lists strips from above tabs

**Files:**
- Modify: `client/src/components/contacts/ContactDetail.tsx:197-238`

- [ ] **Step 1: Delete the tags strip**

Remove lines 197-214 (the `{/* Tags */}` block with `contact.tags.length > 0` and the `border-b` div containing badges).

- [ ] **Step 2: Delete the lists strip**

Remove lines 216-238 (the `{/* Lists */}` block with `contactListIds.length > 0` and the `border-b` div containing list badges).

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
Confirm tags and lists strips no longer appear between header and tabs. The duplicate warning banner (if present) should sit directly above the tabs now.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/contacts/ContactDetail.tsx
git commit -m "feat: remove tags/lists strips from above tabs"
```

---

### Task 3: Merge Detail cards into unified card + hide empty fields

**Files:**
- Modify: `client/src/components/contacts/ContactDetail.tsx:267-321` (Details tab content)
- Modify: `client/src/components/contacts/ContactDetail.tsx:459-498` (DetailSection and DetailField)

- [ ] **Step 1: Update DetailField to hide when empty**

Replace the `DetailField` function (lines 482-498) with:

```tsx
function DetailField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{value}</span>
    </div>
  );
}
```

Key change: `if (!value) return null;` at the top, and `{value}` instead of `{value || '—'}`.

- [ ] **Step 2: Update DetailSection to be a lightweight sub-header (no border card)**

Replace the `DetailSection` function (lines 459-468) with:

```tsx
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="divide-y">{children}</div>
    </div>
  );
}
```

Key change: Removed `rounded-lg border bg-card` wrapper and `border-b` header. Now just a label + children.

- [ ] **Step 3: Wrap the Details tab content in a single card**

Replace the Details tab content (lines 267-323) with:

```tsx
        <TabsContent value="details" className="flex-1 overflow-auto px-6 py-4">
          <div className="max-w-lg rounded-lg border bg-card">
            {/* Contact methods */}
            <DetailSection title="Contact">
              <DetailField icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={contact.phone_number} />
              <DetailField icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} />
              <DetailField icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp" value={contact.whatsapp_name} />
            </DetailSection>

            {/* Personal / work */}
            <DetailSection title="Personal">
              <DetailField icon={<User className="h-3.5 w-3.5" />} label="First Name" value={contact.first_name} />
              <DetailField icon={<User className="h-3.5 w-3.5" />} label="Last Name" value={contact.last_name} />
              <DetailField icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={contact.company} />
            </DetailSection>

            {/* Tags */}
            {contact.tags.length > 0 && (
              <DetailSection title="Tags">
                <div className="flex flex-wrap gap-1 px-4 py-2.5">
                  {contact.tags.map((tagName) => {
                    const color = tagColorMap.get(tagName);
                    return (
                      <Badge
                        key={tagName}
                        variant={color ? 'default' : 'secondary'}
                        className="text-xs"
                        style={color ? { backgroundColor: color, color: 'white' } : undefined}
                      >
                        {tagName}
                      </Badge>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Lists */}
            {contactListIds.length > 0 && (
              <DetailSection title="Lists">
                <div className="flex flex-wrap gap-1 px-4 py-2.5">
                  {contactListIds.map((listId) => {
                    const list = availableLists.find((l) => l.id === listId);
                    if (!list) return null;
                    return (
                      <Badge
                        key={listId}
                        variant="outline"
                        className="text-xs"
                      >
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                        {list.name}
                      </Badge>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Notes */}
            {contact.notes && (
              <DetailSection title="Notes">
                <p className="px-4 py-2.5 text-sm leading-relaxed text-foreground whitespace-pre-wrap">{contact.notes}</p>
              </DetailSection>
            )}

            {/* Address */}
            {hasAddress && (
              <DetailSection title="Address">
                <div className="flex gap-2 px-4 py-2.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm leading-relaxed">
                    {[
                      contact.address_street,
                      [contact.address_city, contact.address_state, contact.address_postal_code].filter(Boolean).join(', '),
                      contact.address_country,
                    ].filter(Boolean).join('\n')}
                  </p>
                </div>
              </DetailSection>
            )}

            {/* Custom Fields */}
            {customFieldValues.length > 0 && (
              <DetailSection title="Additional">
                {customFieldValues.map((cfv) => (
                  <DetailField
                    key={cfv.id}
                    icon={<Hash className="h-3.5 w-3.5" />}
                    label={cfv.field_definition.name}
                    value={
                      cfv.field_definition.field_type === 'multi_select'
                        ? (cfv.value_json || []).join(', ')
                        : cfv.value
                    }
                  />
                ))}
              </DetailSection>
            )}
          </div>
        </TabsContent>
```

Key changes:
- Outer wrapper is now `<div className="max-w-lg rounded-lg border bg-card">` — single card
- Removed `space-y-5` (sections flow inside one card now)
- Tags and lists moved here from the strips we deleted in Task 2
- Notes/Address/Custom Fields kept with same hide-when-empty logic

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
- Select a contact with all fields populated → all sections visible in one card
- Select a sparse contact (only phone) → only Phone row visible, no dashes
- Check tags and lists appear inside the card
- Check Notes/Address only appear when populated

- [ ] **Step 5: Commit**

```bash
git add client/src/components/contacts/ContactDetail.tsx
git commit -m "feat: unified detail card with hidden empty fields"
```

---

## Chunk 2: ContactForm.tsx Changes

### Task 4: Reorder form fields — Phone/Email first, then Name

**Files:**
- Modify: `client/src/components/contacts/ContactForm.tsx:213-262`

- [ ] **Step 1: Swap field order in the form JSX**

Replace the current field grid (lines 214-262, starting at the first `<div className="grid grid-cols-2 gap-4">`, NOT the `<form>` tag on line 213) with:

```tsx
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone Number *</Label>
              <PhoneInput
                value={form.phone_number}
                onChange={(val) => {
                  update('phone_number', val);
                  if (phoneError) setPhoneError('');
                }}
                error={phoneError}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="john@example.com"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={form.first_name}
                onChange={(e) => update('first_name', e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={form.last_name}
                onChange={(e) => update('last_name', e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              placeholder="Acme Inc."
            />
          </div>
```

Same fields, same components, just reordered: Phone + Email row first, then First Name + Last Name row, then Company.

- [ ] **Step 2: Verify visually**

Run: `npm run dev`
- Click "+ New Contact" → Phone/Email appear first, then Name fields
- Edit an existing contact → same order, values populate correctly

- [ ] **Step 3: Commit**

```bash
git add client/src/components/contacts/ContactForm.tsx
git commit -m "feat: reorder contact form fields for consistency with detail view"
```

---

## Chunk 3: Final Verification

### Task 5: End-to-end check

- [ ] **Step 1: Build check**

Run: `npm run build`
Expected: No TypeScript errors, clean build.

- [ ] **Step 2: Visual regression check**

Run: `npm run dev` and verify:
- Contact detail header shows "Created [date]"
- Details tab shows single unified card
- Empty fields hidden (no "—" dashes)
- Tags/lists inside card (not as strips)
- Sparse contact (phone only) shows minimal card
- Rich contact shows full card with all sections
- Edit form has Phone/Email first
- New contact form has Phone/Email first
- Mobile view: back button works, layout responsive

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add client/src/components/contacts/ContactDetail.tsx client/src/components/contacts/ContactForm.tsx
git commit -m "fix: contact detail UX cleanup"
```
