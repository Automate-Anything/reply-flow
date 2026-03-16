// Hex-to-OKLCH conversion and CSS variable override for company brand colors.
// Replaces the default teal hue (155) across the ENTIRE theme with the brand color's hue.

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

// ── Full theme override ─────────────────────────────────────────────
// Each entry: [css-var-name, lightness, chromaScale]
//   chromaScale is a multiplier of the brand color's actual chroma.
//   1.0 = exact brand color intensity.  0.05 = very subtle tint.
//   This means vivid brand colors produce vivid themes and muted
//   brand colors produce muted themes — the intensity always matches.

type ThemeVar = [string, number, number];

const LIGHT_THEME: ThemeVar[] = [
  // Main surfaces — high chroma scale so they ARE the brand color
  ['--sidebar',                       0.25,  0.70],
  ['--sidebar-accent',                0.32,  0.55],
  ['--sidebar-border',                0.32,  0.45],
  ['--sidebar-foreground',            0.93,  0.05],
  ['--sidebar-primary',               0.92,  0.15],
  ['--sidebar-primary-foreground',    0.25,  0.60],
  ['--sidebar-accent-foreground',     0.95,  0.05],
  ['--sidebar-ring',                  0.60,  0.80],

  // Primary (buttons, links) — exact brand color
  ['--primary',                       1.0,   1.0 ],  // special: L=1.0 means "use brand L"
  ['--primary-foreground',            0.985, 0.03],
  ['--ring',                          1.0,   1.0 ],
  ['--chart-1',                       1.0,   1.0 ],

  // Supporting surfaces — moderate tint
  ['--accent',                        0.94,  0.20],
  ['--accent-foreground',             0.205, 0.15],
  ['--secondary',                     0.955, 0.15],
  ['--secondary-foreground',          0.205, 0.12],
  ['--muted',                         0.960, 0.10],
  ['--muted-foreground',              0.50,  0.08],

  // Backgrounds & chrome — subtle tint
  ['--background',                    0.985, 0.03],
  ['--foreground',                    0.145, 0.08],
  ['--card-foreground',               0.145, 0.08],
  ['--popover-foreground',            0.145, 0.08],
  ['--border',                        0.90,  0.10],
  ['--input',                         0.90,  0.12],
];

const DARK_THEME: ThemeVar[] = [
  // Main surfaces
  ['--sidebar',                       0.18,  0.55],
  ['--sidebar-accent',                0.25,  0.45],
  ['--sidebar-border',                0.27,  0.35],
  ['--sidebar-foreground',            0.93,  0.05],
  ['--sidebar-primary',               0.65,  0.80],
  ['--sidebar-primary-foreground',    0.15,  0.50],
  ['--sidebar-accent-foreground',     0.95,  0.05],
  ['--sidebar-ring',                  0.65,  0.80],

  // Primary — exact brand color (slightly boosted L for dark mode)
  ['--primary',                       1.0,   1.0 ],
  ['--primary-foreground',            0.15,  0.05],
  ['--ring',                          1.0,   1.0 ],
  ['--chart-1',                       1.0,   1.0 ],

  // Supporting surfaces
  ['--accent',                        0.28,  0.20],
  ['--accent-foreground',             0.96,  0.05],
  ['--secondary',                     0.25,  0.15],
  ['--secondary-foreground',          0.96,  0.05],
  ['--muted',                         0.25,  0.10],
  ['--muted-foreground',              0.65,  0.08],

  // Backgrounds & chrome
  ['--background',                    0.145, 0.04],
  ['--foreground',                    0.96,  0.05],
  ['--card',                          0.20,  0.08],
  ['--card-foreground',               0.96,  0.05],
  ['--popover',                       0.20,  0.08],
  ['--popover-foreground',            0.96,  0.05],
  ['--border',                        0.30,  0.12],
  ['--input',                         0.28,  0.12],
];

// All variable names — used for cleanup
const ALL_VARS = [...new Set([
  ...LIGHT_THEME.map(([v]) => v),
  ...DARK_THEME.map(([v]) => v),
])];

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Apply a brand color to the document by overriding ALL theme CSS variables.
 * Each variable's chroma is a proportion of the brand color's actual chroma,
 * so the main surfaces (sidebar, accents) are clearly in the brand color and
 * supporting surfaces (backgrounds, borders) get a proportional tint.
 * Entries with L=1.0 use the brand color's exact L and C (for --primary etc.).
 * Pass null to revert to CSS defaults.
 */
export function applyBrandColor(hex: string | null): void {
  const root = document.documentElement;

  if (!hex || !HEX_RE.test(hex)) {
    for (const v of ALL_VARS) root.style.removeProperty(v);
    return;
  }

  const { L: brandL, C: brandC, H } = hexToOklch(hex);
  const dark = isDark();
  const theme = dark ? DARK_THEME : LIGHT_THEME;

  for (const [varName, L, cScale] of theme) {
    if (L === 1.0 && cScale === 1.0) {
      // Exact brand color (--primary, --ring, --chart-1)
      const effectiveL = dark ? Math.min(brandL + 0.08, 0.75) : brandL;
      root.style.setProperty(varName, `oklch(${effectiveL.toFixed(3)} ${brandC.toFixed(4)} ${H.toFixed(1)})`);
    } else {
      const c = brandC * cScale;
      root.style.setProperty(varName, `oklch(${L} ${c.toFixed(4)} ${H.toFixed(1)})`);
    }
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
