# Contact Detail Page UX Improvements

## Problem

The contact detail panel (right side of split view on the Contacts page) wastes vertical space, has weak visual hierarchy, and shows unnecessary clutter from empty fields. The two small cards (Contact / Personal) leave a large empty void below them, and "—" dashes for missing data add noise.

## Priorities (user-defined)

1. Layout & space usage
2. Visual hierarchy
3. Information density
4. Interactivity (lowest — no inline editing in this pass)

## Design

### 1. Header — Add "Created" Timestamp

Add a "Created [date]" label after the phone number in the header sub-line, separated by a `·` dot. This provides useful context about the contact's age without taking extra vertical space.

**Before:**
```
[Y]  Yehoshua King | Automate Anything AI        ✏️ 🗑️
     📞 972539474563  📧 email  🏢 company
```

**After:**
```
[Y]  Yehoshua King | Automate Anything AI        ✏️ 🗑️
     📞 972539474563  📧 email  🏢 company · Created Mar 2, 2026
```

### 2. Details Tab — Unified Card with Hidden Empty Fields

#### Merge sections
Replace the two separate bordered cards (Contact + Personal) with a single "Details" card. Inside, keep lightweight section labels ("CONTACT", "PERSONAL") as small uppercase text — but no separate card borders per group.

#### Hide empty fields
Fields with no value are hidden entirely in the read-only detail view. No more "—" dashes. This means a sparse contact (only phone) shows 1 row; a rich contact shows all rows. Users see what's missing when they open the edit form (which still shows all fields).

#### Move tags and lists into the card
Remove the separate tags and lists border strips that currently sit between the header and the tabs. Instead, render them as subsections inside the unified Details card:
- **Tags** — shown as badges after a "TAGS" label, only if the contact has tags
- **Lists** — shown as outline badges after a "LISTS" label, only if the contact belongs to lists

#### Notes, Address, Custom Fields
Same hide-when-empty logic. These sections appear inside the unified card only when populated.

**Result layout (populated contact):**
```
┌─────────────────────────────────────────┐
│  CONTACT                                │
│  📞 Phone       972539474563            │
│  💬 WhatsApp    Leman Hayeled Org       │
│                                         │
│  PERSONAL                               │
│  👤 First Name  Yehoshua King           │
│                                         │
│  TAGS                                   │
│  [VIP] [Hebrew]                         │
│                                         │
│  LISTS                                  │
│  [● Newsletter] [● Leads]              │
└─────────────────────────────────────────┘
```

### 3. Duplicate Warning Banner — No Changes

Stays between header and tabs. Works well as-is.

### 4. Other Tabs (Activity, Sessions, Memories) — No Changes

These tabs are not affected by the space/hierarchy issues.

### 5. ContactForm (Edit / Add) — Field Order Alignment

The form keeps all fields visible (users need to see what they can fill in). One change: reorder fields to match the detail view's grouping:

**Current order:** First Name, Last Name → Email, Phone → Company → ...
**New order:** Phone, Email → First Name, Last Name → Company → ...

This creates mental consistency between the read and edit views — Contact info first, then Personal info.

## Files Changed

| File | Change |
|------|--------|
| `client/src/components/contacts/ContactDetail.tsx` | Merge cards, hide empties, move tags/lists into card, add created date |
| `client/src/components/contacts/ContactForm.tsx` | Reorder fields (phone/email before name) |

No new components, no backend changes, no migrations.

## Acceptance Criteria

- [ ] Detail view shows a single unified card instead of two separate cards
- [ ] Empty fields are hidden in the detail view (no "—" dashes)
- [ ] Tags and lists appear inside the detail card (not as separate strips above tabs)
- [ ] Tags/lists subsections hidden when contact has none
- [ ] Header shows "Created [date]" after phone number
- [ ] Notes, Address, Custom Fields sections only render when populated
- [ ] ContactForm field order: Phone, Email first; then First Name, Last Name; then Company
- [ ] No visual regressions on mobile (back button, responsive stacking)
