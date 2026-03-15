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
