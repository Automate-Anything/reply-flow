# Company Branding (White-Label Logo & Color Scheme)

**Date:** 2026-03-16
**Status:** Approved

## Overview

Allow each company to upload their own logo (replacing the Reply Flow logo in the sidebar) and choose a brand color scheme that applies across the entire app (primary buttons, links, active states, sidebar accents).

## Requirements

- Companies can upload a logo image (PNG, JPG, WebP; max 2MB)
- Companies can pick a brand color from 8-10 presets or enter a custom hex value
- The brand color overrides `--primary` and related CSS variables app-wide
- The logo replaces the Reply Flow icon/text in the sidebar
- Changes are managed in the Company Settings page (Branding card)
- Only users with `company_settings.edit` permission can modify branding

## Database Changes

### Existing column (no change needed)
- `companies.logo_url` — already exists, nullable TEXT. Stores the public URL of the uploaded logo.

### New column
- `companies.brand_color` — `TEXT NULL`. Stores a hex color like `#2563eb`. Null means "use default teal".

### Supabase Storage
- New bucket: `company-logos` (public read, authenticated write)
- All access goes through server using `supabaseAdmin` (bypasses RLS), but add a defense-in-depth RLS policy restricting uploads to `{company_id}/` prefix
- Bucket creation via SQL migration: `INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true)`
- Path convention: `{company_id}/logo.{ext}` (overwrite on re-upload)
- Accepted: PNG, JPG, WebP (no SVG — security risk from embedded scripts, matching existing avatar upload pattern)
- Max 2MB

## API Changes

### `POST /company/logo`
- Accepts `multipart/form-data` with a `logo` file field
- Validates file type (image/jpeg, image/png, image/webp) and size (max 2MB)
- **Upload sequence** (handles extension changes safely):
  1. List all existing files in `company-logos/{companyId}/` prefix
  2. Upload new file to `company-logos/{companyId}/logo.{ext}` with `upsert: true`
  3. Delete any old files with different extensions (e.g., old `logo.png` when uploading `logo.jpg`)
  4. Update `companies.logo_url` with the public URL + `?t={timestamp}` for cache-busting (matching existing avatar upload pattern)
  5. If DB update fails, delete the newly uploaded file (best-effort cleanup)
- Returns `{ logo_url: string }`
- Requires `company_settings.edit` permission

### `DELETE /company/logo`
- Lists and removes all files in `company-logos/{companyId}/` prefix
- Sets `companies.logo_url = null`
- Returns `{ success: true }`
- Requires `company_settings.edit` permission

### `PUT /company` (existing — requires code change)
- **Code change needed:** Add `brand_color` to the destructured fields list and the `updates` object in `server/src/routes/company.ts` (line 123)
- **Server-side validation:** Regex check `/^#[0-9a-fA-F]{6}$/` — reject values that don't match. Accept `null` to reset to default.

### `GET /me` (existing — requires code change)
- **Code change needed:** The `/me` route in `server/src/routes/me.ts` uses an explicit column select for companies: `companies(id, name, slug, logo_url, timezone)`. Must add `brand_color` to this select. This select appears twice in the file (for existing members and auto-created companies) — both must be updated.

## Frontend: Brand Color System

### Color utility (`client/src/lib/brand-colors.ts`)

**`applyBrandColor(hex: string | null)`**
- Converts hex to OKLCH color space
- Sets CSS variables on `document.documentElement`:
  - `--primary` (L=0.55 light, L=0.60 dark)
  - `--primary-foreground` (white or dark based on contrast)
  - `--ring` (same as primary)
  - `--sidebar-primary` (same as primary)
  - `--sidebar-primary-foreground` (same as primary-foreground)
  - `--chart-1` (same as primary)
- When `hex` is null, removes overrides (CSS defaults take effect)
- Hue and chroma extracted from hex; only lightness adjusted per theme
- Client-side hex validation before applying (defense in depth)

**Dark mode sync:**
- A `MutationObserver` on `<html>` class detects `dark` toggle and re-applies with adjusted lightness

**Preset colors:**
| Name | Hex |
|------|-----|
| Teal (default) | `null` (CSS default) |
| Blue | `#2563eb` |
| Indigo | `#6366f1` |
| Purple | `#9333ea` |
| Pink | `#ec4899` |
| Rose | `#f43f5e` |
| Orange | `#f97316` |
| Emerald | `#10b981` |
| Slate | `#64748b` |

Note: Teal preset uses `null` (no override) which falls back to the CSS default. The UI should show a checkmark on "Teal" when `brand_color` is null.

### Cache behavior
- Brand color is part of the `/me` response cached in localStorage
- On page load, the cached value is applied before the network call returns (no flash of default teal)

## Frontend: SessionContext Changes

**`MeResponse` interface** — add `brand_color: string | null` to the `company` type (currently only has `id, name, slug, logo_url, timezone`).

**Add to `SessionContextType`:**
- `companyLogoUrl: string | null`
- `companyBrandColor: string | null`

**Add to `SessionProvider`:**
- New `useState` for each field, initialized from `cachedMe?.company?.logo_url` and `cachedMe?.company?.brand_color`
- Update both in `fetchMe()` alongside other company fields

**On load and refresh:** if `brand_color` exists, call `applyBrandColor(brand_color)`. If null, call `applyBrandColor(null)` to clear any stale overrides.

## Frontend: Settings UI

### New "Branding" card in CompanySettingsPage

Placed between "Company Information" and "Business Hours" cards.

**Logo upload area:**
- Displays current logo in ~80px circle (or placeholder with company initial)
- "Upload Logo" button opens file picker (png/jpg/webp, max 2MB)
- Shows loading spinner during upload, POSTs to `/company/logo`, updates preview
- "Remove" button (shown when logo exists) calls `DELETE /company/logo`
- Client-side validation: file type + size before uploading

**Color scheme picker:**
- Label: "Brand Color"
- Row of 8-10 preset color circles with check/ring on selected
- Last option: "Custom" circle with paint icon, clicking opens hex input below
- **Live preview**: clicking preset or typing hex calls `applyBrandColor` immediately
- If user navigates away without saving, color reverts to saved value (calls `applyBrandColor` with the original saved value)
- Brand color saved via existing "Save Changes" button with `PUT /company`
- **`hasChanges` memo** must include `brandColor` comparison (currently at CompanySettingsPage.tsx line 98)

## Frontend: Sidebar Logo

### Current behavior (Sidebar.tsx:74-80)
- Hardcoded `MessageSquareText` icon in `bg-primary` box + "Reply Flow" text

### New behavior
- Read `companyLogoUrl` and `companyName` from `useSession()`
- **If logo exists**: render `<img>` (32x32, `rounded-lg`, `object-contain`). Alt = company name.
- **If no logo**: keep `MessageSquareText` icon in `bg-primary` box (reflects brand color)
- **Text**: show `companyName` instead of hardcoded "Reply Flow". Falls back to "Reply Flow" if null.
- Collapsed sidebar: only logo/icon shows (same as current)

## Files to Create/Modify

### New files
- `supabase/migrations/xxx_add_brand_color.sql` — adds `brand_color` column + creates `company-logos` storage bucket
- `client/src/lib/brand-colors.ts` — hex-to-OKLCH conversion + CSS variable application + MutationObserver
- `server/src/routes/company-logo.ts` (or add to existing `company.ts`) — logo upload/delete endpoints

### Modified files
- `server/src/routes/me.ts` — add `brand_color` to the companies select (two locations)
- `server/src/routes/company.ts` — add `brand_color` to PUT destructuring + hex validation
- `server/src/index.ts` — register logo upload route (if separate file)
- `client/src/contexts/SessionContext.tsx` — update `MeResponse` type, add `companyLogoUrl`, `companyBrandColor`, apply brand color on load
- `client/src/pages/CompanySettingsPage.tsx` — add Branding card with logo upload + color picker, update `hasChanges`
- `client/src/components/layout/Sidebar.tsx` — replace hardcoded logo/text with dynamic version
