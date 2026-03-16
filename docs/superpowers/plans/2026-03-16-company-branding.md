# Company Branding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow companies to upload a custom logo and pick a brand color that replaces the default Reply Flow branding across the app.

**Architecture:** A new `brand_color` column on `companies` stores a hex value. On app load, a utility converts this hex to OKLCH and overrides CSS custom properties (`--primary`, `--ring`, etc.) on `document.documentElement`. Logo files are uploaded to a `company-logos` Supabase Storage bucket via a new server endpoint, and the public URL is stored in the existing `logo_url` column. The sidebar renders the company logo/name instead of the hardcoded Reply Flow branding.

**Tech Stack:** React 19, TypeScript, Express 5, Supabase (Postgres + Storage), Tailwind CSS v4 (OKLCH), multer, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-16-company-branding-design.md`

---

## Chunk 1: Database + Backend

### Task 1: Migration — Add `brand_color` column + Storage bucket

**Files:**
- Create: `supabase/migrations/062_company_branding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add brand_color column to companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS brand_color text;

-- Add CHECK constraint for hex format
ALTER TABLE public.companies
  ADD CONSTRAINT companies_brand_color_hex_check
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');

-- Create company-logos storage bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Defense-in-depth RLS policy on storage (uploads go through supabaseAdmin which bypasses RLS,
-- but this protects against accidental direct client access)
CREATE POLICY "company_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'company-logos');

CREATE POLICY "company_logos_authenticated_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'company-logos'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "company_logos_authenticated_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'company-logos'
    AND auth.role() = 'authenticated'
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/062_company_branding.sql
git commit -m "feat(db): add brand_color column and company-logos storage bucket"
```

---

### Task 2: Server — Add `brand_color` to PUT /company + GET /me

**Files:**
- Modify: `server/src/routes/company.ts:120-148` (PUT handler)
- Modify: `server/src/routes/me.ts:42,90` (companies select)

- [ ] **Step 1: Add `brand_color` to the PUT /company destructuring and validation**

In `server/src/routes/company.ts`, line 123, add `brand_color` to the destructured fields (note: `auto_create_contacts` is already at the end — add `brand_color` after it):

```typescript
const { name, slug, logo_url, timezone, default_language, business_hours, session_timeout_hours, business_type, business_description, auto_assign_mode, auto_create_contacts, brand_color } = req.body;
```

Then after the `auto_create_contacts` block (after line 151), add:

```typescript
    if (brand_color !== undefined) {
      if (brand_color !== null && !/^#[0-9a-fA-F]{6}$/.test(brand_color)) {
        res.status(400).json({ error: 'brand_color must be a valid hex color (e.g. #2563eb) or null' });
        return;
      }
      updates.brand_color = brand_color;
    }
```

- [ ] **Step 2: Add `brand_color` to the /me companies select (two locations)**

In `server/src/routes/me.ts`, line 42, change the select from:

```
companies(id, name, slug, logo_url, timezone)
```

to:

```
companies(id, name, slug, logo_url, timezone, brand_color)
```

Same change on line 90 (the auto-created company re-fetch).

- [ ] **Step 3: Verify the server compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/company.ts server/src/routes/me.ts
git commit -m "feat(api): add brand_color to PUT /company and GET /me"
```

---

### Task 3: Server — Logo upload and delete endpoints

**Files:**
- Modify: `server/src/routes/company.ts` (add logo endpoints at the end, before `export default`)

We add the logo endpoints to the existing `company.ts` file since it already handles all company operations. We reuse the same multer pattern from `me.ts`.

- [ ] **Step 1: Add multer import and config at the top of company.ts**

Add after the existing imports (line 5):

```typescript
import multer from 'multer';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});
```

- [ ] **Step 2: Add POST /logo endpoint**

Add before `export default router;`:

```typescript
// ────────────────────────────────────────────────
// UPLOAD COMPANY LOGO
// ────────────────────────────────────────────────
router.post('/logo', requirePermission('company_settings', 'edit'), logoUpload.single('logo'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const ext = file.mimetype === 'image/png' ? 'png'
      : file.mimetype === 'image/webp' ? 'webp'
      : 'jpg';

    const storagePath = `${companyId}/logo.${ext}`;

    // Upload new logo first (safer: old file remains if upload fails)
    const { error: storageError } = await supabaseAdmin.storage
      .from('company-logos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (storageError) {
      console.error('Logo upload error:', storageError);
      res.status(500).json({ error: 'Failed to upload logo' });
      return;
    }

    // Clean up old files with different extensions (e.g., old logo.png when uploading logo.jpg)
    const { data: existingFiles } = await supabaseAdmin.storage
      .from('company-logos')
      .list(companyId);

    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles
        .map((f) => `${companyId}/${f.name}`)
        .filter((path) => path !== storagePath);
      if (filesToDelete.length > 0) {
        await supabaseAdmin.storage.from('company-logos').remove(filesToDelete);
      }
    }

    // Get public URL with cache-busting
    const { data: urlData } = supabaseAdmin.storage
      .from('company-logos')
      .getPublicUrl(storagePath);

    const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update company record
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update({ logo_url: logoUrl })
      .eq('id', companyId)
      .select()
      .single();

    if (error) {
      // Best-effort cleanup if DB update fails
      await supabaseAdmin.storage.from('company-logos').remove([storagePath]);
      throw error;
    }

    res.json({ logo_url: data.logo_url });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// DELETE COMPANY LOGO
// ────────────────────────────────────────────────
router.delete('/logo', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // List and remove all files in the company's logo folder
    const { data: existingFiles } = await supabaseAdmin.storage
      .from('company-logos')
      .list(companyId);

    if (existingFiles && existingFiles.length > 0) {
      const filePaths = existingFiles.map((f) => `${companyId}/${f.name}`);
      await supabaseAdmin.storage.from('company-logos').remove(filePaths);
    }

    // Clear logo_url in company record
    const { error } = await supabaseAdmin
      .from('companies')
      .update({ logo_url: null })
      .eq('id', companyId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Verify the server compiles**

Run: `npx tsc --noEmit --project server/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/company.ts
git commit -m "feat(api): add logo upload and delete endpoints"
```

---

## Chunk 2: Frontend — Brand Color System

### Task 4: Brand color utility

**Files:**
- Create: `client/src/lib/brand-colors.ts`

- [ ] **Step 1: Create the brand color utility**

```typescript
// Hex-to-OKLCH conversion and CSS variable override for company brand colors.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Preset brand colors — null means "use CSS default (teal)". */
export const BRAND_PRESETS: { name: string; hex: string | null }[] = [
  { name: 'Teal', hex: null },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Slate', hex: '#64748b' },
];

// ── Hex → sRGB → OKLCH conversion ──────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function hexToOklch(hex: string): { L: number; C: number; H: number } {
  const [r, g, b] = hexToRgb(hex);
  const [L, a, bVal] = linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  const C = Math.sqrt(a * a + bVal * bVal);
  let H = (Math.atan2(bVal, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

// ── CSS variable application ────────────────────────────────────────

const CSS_VARS_TO_OVERRIDE = [
  '--primary',
  '--ring',
  '--sidebar-primary',
  '--sidebar-ring',
  '--chart-1',
] as const;

const FOREGROUND_VARS = [
  '--primary-foreground',
  '--sidebar-primary-foreground',
] as const;

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

function buildOklch(L: number, C: number, H: number): string {
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

/**
 * Apply a brand color to the document by overriding CSS custom properties.
 * Pass null to revert to CSS defaults.
 */
export function applyBrandColor(hex: string | null): void {
  const root = document.documentElement;

  if (!hex || !HEX_RE.test(hex)) {
    // Remove overrides — fall back to CSS defaults
    for (const v of CSS_VARS_TO_OVERRIDE) root.style.removeProperty(v);
    for (const v of FOREGROUND_VARS) root.style.removeProperty(v);
    return;
  }

  const { C, H } = hexToOklch(hex);
  const dark = isDark();

  // Primary color: lighter in dark mode for good contrast
  const primaryL = dark ? 0.60 : 0.55;
  const primaryValue = buildOklch(primaryL, C, H);

  for (const v of CSS_VARS_TO_OVERRIDE) {
    root.style.setProperty(v, primaryValue);
  }

  // Foreground: match existing convention — light mode uses light text on primary,
  // dark mode uses dark text on primary (see index.css defaults)
  const fgValue = dark
    ? 'oklch(0.15 0.02 155)'   // dark text on lighter primary (matches --primary-foreground in .dark)
    : 'oklch(0.985 0.005 155)'; // light text on darker primary (matches --primary-foreground in :root)

  for (const v of FOREGROUND_VARS) {
    root.style.setProperty(v, fgValue);
  }
}

// ── Dark mode observer ──────────────────────────────────────────────

let currentHex: string | null = null;
let observer: MutationObserver | null = null;

/**
 * Set the brand color and start watching for dark mode changes.
 * Call with null to clear.
 */
export function setBrandColor(hex: string | null): void {
  currentHex = hex;
  applyBrandColor(hex);

  // Set up observer once
  if (!observer) {
    observer = new MutationObserver(() => {
      applyBrandColor(currentHex);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/brand-colors.ts
git commit -m "feat: add brand color utility with hex-to-OKLCH conversion"
```

---

### Task 5: SessionContext — Add branding fields + apply on load

**Files:**
- Modify: `client/src/contexts/SessionContext.tsx`

- [ ] **Step 1: Add import for setBrandColor**

At the top of the file, add:

```typescript
import { setBrandColor } from '@/lib/brand-colors';
```

- [ ] **Step 2: Update MeResponse interface**

Change the `company` type in `MeResponse` (line 16) from:

```typescript
  company: { id: string; name: string; slug: string | null; logo_url: string | null; timezone: string | null } | null;
```

to:

```typescript
  company: { id: string; name: string; slug: string | null; logo_url: string | null; timezone: string | null; brand_color: string | null } | null;
```

- [ ] **Step 3: Add to SessionContextType interface**

After `companyTimezone: string;` (line 31), add:

```typescript
  companyLogoUrl: string | null;
  companyBrandColor: string | null;
```

- [ ] **Step 4: Add useState hooks in SessionProvider**

After the `companyTimezone` useState (line 75), add:

```typescript
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(cachedMe?.company?.logo_url ?? null);
  const [companyBrandColor, setCompanyBrandColor] = useState<string | null>(cachedMe?.company?.brand_color ?? null);
```

- [ ] **Step 5: Apply cached brand color on mount**

After the useState hooks and refs, add a `useEffect` with an empty dependency array to apply the cached brand color on first render. Place it right after `sessionRef` (after line 80):

```typescript
  // Apply cached brand color on mount to prevent flash of default teal
  useEffect(() => {
    setBrandColor(cachedMe?.company?.brand_color ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Note: The empty dependency array ensures this runs once on mount. The cached value is available synchronously from localStorage so this applies very early. The eslint-disable is needed because `cachedMe` is intentionally read only once.

- [ ] **Step 6: Update fetchMe to set new fields**

In `fetchMe`, after `setCompanyTimezone(data.company?.timezone || 'UTC');` (line 98), add:

```typescript
      setCompanyLogoUrl(data.company?.logo_url ?? null);
      setCompanyBrandColor(data.company?.brand_color ?? null);
      setBrandColor(data.company?.brand_color ?? null);
```

- [ ] **Step 7: Clear new fields on sign-out**

In `updateSession` when `newSession` is null, after `setCompanyTimezone('UTC');` (line 130), add:

```typescript
      setCompanyLogoUrl(null);
      setCompanyBrandColor(null);
      setBrandColor(null);
```

- [ ] **Step 8: Add new fields to context value**

In the `value` object (after `companyTimezone,` on line 226), add:

```typescript
    companyLogoUrl,
    companyBrandColor,
```

- [ ] **Step 9: Verify the client compiles**

Run: `npx tsc --noEmit --project client/tsconfig.json`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 10: Commit**

```bash
git add client/src/contexts/SessionContext.tsx
git commit -m "feat: add companyLogoUrl and companyBrandColor to SessionContext"
```

---

## Chunk 3: Frontend — UI Components

### Task 6: Sidebar — Dynamic logo and company name

**Files:**
- Modify: `client/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update the sidebar header**

Replace the logo/text block (lines 74-81):

```typescript
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <MessageSquareText className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold text-sidebar-foreground">
            Reply Flow
          </span>
        )}
```

with:

```typescript
        {companyLogoUrl ? (
          <img
            src={companyLogoUrl}
            alt={companyName || 'Company logo'}
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <MessageSquareText className="h-4 w-4 text-primary-foreground" />
          </div>
        )}
        {!collapsed && (
          <span className="text-lg font-semibold text-sidebar-foreground">
            {companyName || 'Reply Flow'}
          </span>
        )}
```

- [ ] **Step 2: Destructure new fields from useSession**

Change line 37 from:

```typescript
  const { hasPermission } = useSession();
```

to:

```typescript
  const { hasPermission, companyLogoUrl, companyName } = useSession();
```

- [ ] **Step 3: Verify the client compiles**

Run: `npx tsc --noEmit --project client/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/layout/Sidebar.tsx
git commit -m "feat: render company logo and name in sidebar"
```

---

### Task 7: Company Settings — Branding card (logo upload + color picker)

**Files:**
- Modify: `client/src/pages/CompanySettingsPage.tsx`

This is the largest task. We add a "Branding" card with logo upload and color scheme picker.

- [ ] **Step 0: Add `brand_color` to the local Company interface**

In `CompanySettingsPage.tsx`, add `brand_color` to the `Company` interface (line 29-38):

```typescript
interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  timezone: string;
  session_timeout_hours: number;
  business_type: string | null;
  business_description: string | null;
  brand_color: string | null;
}
```

- [ ] **Step 1: Add imports**

Add at the top of the file, with the existing imports:

```typescript
import { BRAND_PRESETS, applyBrandColor } from '@/lib/brand-colors';
import { Paintbrush, Upload, X } from 'lucide-react';
```

Also add `useRef` to the react import. Change line 1 from:

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react';
```

to:

```typescript
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
```

- [ ] **Step 2: Add state for brand color and logo**

After the existing `tzSearch` state (line 70), add:

```typescript
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [savedBrandColor, setSavedBrandColor] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [customColorInput, setCustomColorInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Populate branding state from fetched company**

In `fetchCompany`, after `setTimezone(data.company.timezone || 'UTC');` (line 80), add:

```typescript
      setBrandColor(data.company.brand_color || null);
      setSavedBrandColor(data.company.brand_color || null);
      setLogoUrl(data.company.logo_url || null);
      const isCustom = data.company.brand_color && !BRAND_PRESETS.some(p => p.hex === data.company.brand_color);
      if (isCustom) {
        setCustomColorInput(data.company.brand_color);
        setShowCustomInput(true);
      }
```

- [ ] **Step 4: Update hasChanges to include brandColor**

Replace the `hasChanges` memo (lines 98-106) with:

```typescript
  const hasChanges = useMemo(() => {
    if (!company) return false;
    return (
      name.trim() !== company.name ||
      businessType.trim() !== (company.business_type || '') ||
      businessDescription.trim() !== (company.business_description || '') ||
      timezone !== (company.timezone || 'UTC') ||
      brandColor !== savedBrandColor
    );
  }, [company, name, businessType, businessDescription, timezone, brandColor, savedBrandColor]);
```

- [ ] **Step 5: Add brandColor to handleSave**

In `handleSave`, add `brand_color` to the PUT request body. Change the api.put call (lines 115-120) to:

```typescript
      const { data } = await api.put('/company', {
        name: name.trim(),
        business_type: businessType.trim() || null,
        business_description: businessDescription.trim() || null,
        timezone,
        brand_color: brandColor,
      });
      setCompany(data.company);
      setSavedBrandColor(data.company.brand_color || null);
      await refresh(); // sync SessionContext so sidebar and other components get the new brand color
```

- [ ] **Step 6: Add revert-on-navigate for live preview**

After the `handleSave` function, add:

```typescript
  // Revert live brand color preview if user leaves without saving
  useEffect(() => {
    return () => {
      // On unmount, re-apply the saved color (in case user previewed but didn't save)
      applyBrandColor(savedBrandColor);
    };
  }, [savedBrandColor]);

  const handleBrandColorChange = (hex: string | null) => {
    setBrandColor(hex);
    applyBrandColor(hex); // live preview
    setShowCustomInput(false);
    setCustomColorInput('');
  };

  const handleCustomColorApply = () => {
    const val = customColorInput.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setBrandColor(val);
      applyBrandColor(val);
    } else {
      toast.error('Enter a valid hex color (e.g. #2563eb)');
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post('/company/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLogoUrl(data.logo_url);
      await refresh();
      toast.success('Logo uploaded');
    } catch {
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    setRemovingLogo(true);
    try {
      await api.delete('/company/logo');
      setLogoUrl(null);
      await refresh();
      toast.success('Logo removed');
    } catch {
      toast.error('Failed to remove logo');
    } finally {
      setRemovingLogo(false);
    }
  };
```

- [ ] **Step 7: Add the Branding card JSX**

Insert the Branding card between the closing `</Card>` of "Company Information" (line 266) and `<BusinessHoursSettings />` (line 268). Add:

```tsx
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Paintbrush className="h-4 w-4" />
            Branding
          </CardTitle>
          <CardDescription>Customize your company's logo and color scheme.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo upload */}
          <div className="space-y-3">
            <Label>Company Logo</Label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={name || 'Company logo'}
                  className="h-20 w-20 rounded-xl border object-contain p-1"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border bg-muted text-2xl font-bold text-muted-foreground">
                  {(name || 'C').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={!canEdit}
                />
                <PlanGate>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || uploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {uploadingLogo ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Upload Logo
                  </Button>
                </PlanGate>
                {logoUrl && (
                  <PlanGate>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit || removingLogo}
                      onClick={handleLogoRemove}
                      className="text-destructive hover:text-destructive"
                    >
                      {removingLogo ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Remove
                    </Button>
                  </PlanGate>
                )}
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, or WebP. Max 2MB.
                </p>
              </div>
            </div>
          </div>

          {/* Brand color picker */}
          <div className="space-y-3">
            <Label>Brand Color</Label>
            <p className="text-xs text-muted-foreground">
              Applies to buttons, links, and accents across the app.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  disabled={!canEdit}
                  title={preset.name}
                  className={cn(
                    'relative h-8 w-8 rounded-full border-2 transition-all hover:scale-110 disabled:opacity-50',
                    brandColor === preset.hex
                      ? 'border-foreground ring-2 ring-foreground/20'
                      : 'border-transparent'
                  )}
                  style={{ backgroundColor: preset.hex || '#0d9488' }}
                  onClick={() => handleBrandColorChange(preset.hex)}
                >
                  {brandColor === preset.hex && (
                    <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />
                  )}
                </button>
              ))}
              {/* Custom color button */}
              <button
                type="button"
                disabled={!canEdit}
                title="Custom color"
                className={cn(
                  'relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all hover:scale-110 disabled:opacity-50',
                  showCustomInput && brandColor && !BRAND_PRESETS.some(p => p.hex === brandColor)
                    ? 'border-foreground ring-2 ring-foreground/20'
                    : 'border-muted-foreground/30',
                  'bg-gradient-to-br from-red-400 via-blue-400 to-green-400'
                )}
                onClick={() => setShowCustomInput(!showCustomInput)}
              >
                <Paintbrush className="h-3.5 w-3.5 text-white" />
              </button>
            </div>
            {showCustomInput && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="#2563eb"
                  value={customColorInput}
                  onChange={(e) => setCustomColorInput(e.target.value)}
                  disabled={!canEdit}
                  className="w-32 font-mono"
                  maxLength={7}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={handleCustomColorApply}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 8: Verify useSession destructuring**

Line 57 already destructures `{ hasPermission, role, companyName, refresh }` — no change needed. The `refresh` function is already available for the logo upload and save handlers.

- [ ] **Step 9: Verify the client compiles**

Run: `npx tsc --noEmit --project client/tsconfig.json`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/CompanySettingsPage.tsx
git commit -m "feat: add branding card with logo upload and color picker to settings"
```

---

## Chunk 4: Migration Execution + Final Verification

### Task 8: Run migration and verify end-to-end

- [ ] **Step 1: Run the migration**

The migration file `supabase/migrations/062_company_branding.sql` needs to be executed against the live database. Remind the user:

> **Migration ready:** `supabase/migrations/062_company_branding.sql` adds the `brand_color` column and creates the `company-logos` storage bucket. Please run this migration.

- [ ] **Step 2: Build both client and server**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Manual smoke test checklist**

1. Open Company Settings → Branding card is visible
2. Click a preset color → app theme changes immediately (live preview)
3. Click Save → color persists on reload
4. Pick "Custom" → enter `#ff5500` → Apply → theme updates
5. Upload a JPEG logo → appears in preview and sidebar
6. Upload a PNG logo → replaces JPEG, old file cleaned up
7. Remove logo → sidebar reverts to icon
8. Toggle dark mode → brand color adjusts lightness
9. Log out and back in → brand color applies from cache (no flash)
10. Set color back to Teal (null) → reverts to default

- [ ] **Step 4: Final commit with any adjustments**

```bash
git add -A
git commit -m "feat: company branding — logo upload and color scheme customization"
```
