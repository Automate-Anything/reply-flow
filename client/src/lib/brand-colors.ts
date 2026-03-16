// Hex-to-OKLCH conversion and CSS variable override for company brand colors.
// Replaces the default teal hue (155) across the ENTIRE theme with the brand color's hue.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Preset brand colors — null means "use CSS default (teal)".
 *  Hex values are the sRGB equivalent of oklch(0.55 0.17 H) so the
 *  swatch visually matches what --primary becomes on the site. */
export const BRAND_PRESETS: { name: string; hex: string | null }[] = [
  { name: 'Teal', hex: null },
  { name: 'Blue', hex: '#366bd3' },
  { name: 'Indigo', hex: '#5c62d2' },
  { name: 'Purple', hex: '#8552c2' },
  { name: 'Pink', hex: '#b53c7f' },
  { name: 'Rose', hex: '#c03a51' },
  { name: 'Orange', hex: '#af540f' },
  { name: 'Emerald', hex: '#148659' },
  { name: 'Cyan', hex: '#13808f' },
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
// L and C values are copied EXACTLY from index.css so the brand override
// looks identical to the default teal theme — just with a different hue.

type ThemeVar = [string, number, number];

// Light theme — L/C copied verbatim from :root in index.css
const LIGHT_THEME: ThemeVar[] = [
  ['--background',                    0.985, 0.002],
  ['--foreground',                    0.145, 0.005],
  ['--card-foreground',               0.145, 0.005],
  ['--popover-foreground',            0.145, 0.005],
  ['--primary',                       0.55,  0.17 ],
  ['--primary-foreground',            0.985, 0.005],
  ['--secondary',                     0.965, 0.015],
  ['--secondary-foreground',          0.205, 0.02 ],
  ['--muted',                         0.965, 0.01 ],
  ['--muted-foreground',              0.50,  0.01 ],
  ['--accent',                        0.94,  0.03 ],
  ['--accent-foreground',             0.205, 0.02 ],
  ['--border',                        0.90,  0.01 ],
  ['--input',                         0.90,  0.015],
  ['--ring',                          0.55,  0.17 ],
  ['--chart-1',                       0.55,  0.17 ],
  ['--sidebar',                       0.22,  0.03 ],
  ['--sidebar-foreground',            0.92,  0.01 ],
  ['--sidebar-primary',               0.55,  0.17 ],
  ['--sidebar-primary-foreground',    0.985, 0.005],
  ['--sidebar-accent',                0.30,  0.04 ],
  ['--sidebar-accent-foreground',     0.98,  0.01 ],
  ['--sidebar-border',                0.30,  0.03 ],
  ['--sidebar-ring',                  0.55,  0.17 ],
];

// Dark theme — L/C copied verbatim from .dark in index.css
const DARK_THEME: ThemeVar[] = [
  ['--background',                    0.145, 0.01 ],
  ['--foreground',                    0.96,  0.005],
  ['--card',                          0.20,  0.015],
  ['--card-foreground',               0.96,  0.005],
  ['--popover',                       0.20,  0.015],
  ['--popover-foreground',            0.96,  0.005],
  ['--primary',                       0.60,  0.17 ],
  ['--primary-foreground',            0.15,  0.02 ],
  ['--secondary',                     0.25,  0.02 ],
  ['--secondary-foreground',          0.96,  0.005],
  ['--muted',                         0.25,  0.015],
  ['--muted-foreground',              0.65,  0.015],
  ['--accent',                        0.28,  0.03 ],
  ['--accent-foreground',             0.96,  0.005],
  ['--border',                        0.30,  0.02 ],
  ['--input',                         0.28,  0.02 ],
  ['--ring',                          0.60,  0.17 ],
  ['--chart-1',                       0.60,  0.17 ],
  ['--sidebar',                       0.16,  0.015],
  ['--sidebar-foreground',            0.92,  0.01 ],
  ['--sidebar-primary',               0.60,  0.17 ],
  ['--sidebar-primary-foreground',    0.96,  0.005],
  ['--sidebar-accent',                0.24,  0.03 ],
  ['--sidebar-accent-foreground',     0.96,  0.005],
  ['--sidebar-border',                0.25,  0.02 ],
  ['--sidebar-ring',                  0.60,  0.17 ],
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
 * Apply a brand color by replacing the hue across all theme variables.
 * L and C stay identical to the default CSS so the visual style matches
 * the default teal theme exactly — only the hue changes.
 * Pass null to revert to CSS defaults.
 */
export function applyBrandColor(hex: string | null): void {
  const root = document.documentElement;

  if (!hex || !HEX_RE.test(hex)) {
    for (const v of ALL_VARS) root.style.removeProperty(v);
    return;
  }

  const { H } = hexToOklch(hex);
  const theme = isDark() ? DARK_THEME : LIGHT_THEME;

  for (const [varName, L, C] of theme) {
    root.style.setProperty(varName, `oklch(${L} ${C} ${H.toFixed(1)})`);
  }
}

/**
 * Returns the CSS color string that --primary would be for the given hex.
 * Use this for swatch backgrounds so they match exactly what the browser
 * renders for --primary (no hex round-trip mismatch).
 */
export function primaryColorForHex(hex: string | null): string {
  if (!hex || !HEX_RE.test(hex)) return 'oklch(0.55 0.17 160)'; // default teal
  const { H } = hexToOklch(hex);
  return `oklch(0.55 0.17 ${H.toFixed(1)})`;
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
