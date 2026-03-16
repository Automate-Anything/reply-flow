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
// Two kinds of variables:
//   "primary" vars — use the EXACT L, C, H from the picked hex so the
//     hero color visually matches the swatch the user clicked.
//   "ambient" vars — keep fixed L/C from the default theme and only
//     rotate the hue, so backgrounds/borders/cards shift subtly.

type ThemeVar = [string, number, number];

// Variables whose L and C come from the picked hex (the "hero" color)
const PRIMARY_VARS = new Set([
  '--primary',
  '--ring',
  '--chart-1',
  '--sidebar-primary',
  '--sidebar-ring',
]);

// Ambient variables — fixed L/C, only hue rotated.
// Chroma values are intentionally higher than the base theme so the
// brand color is clearly visible on every surface (sidebar, cards, borders).
const LIGHT_AMBIENT: ThemeVar[] = [
  ['--background',                    0.985, 0.007],
  ['--foreground',                    0.145, 0.015],
  ['--card-foreground',               0.145, 0.015],
  ['--popover-foreground',            0.145, 0.015],
  ['--primary-foreground',            0.985, 0.01 ],
  ['--secondary',                     0.955, 0.04 ],
  ['--secondary-foreground',          0.205, 0.03 ],
  ['--muted',                         0.960, 0.03 ],
  ['--muted-foreground',              0.50,  0.02 ],
  ['--accent',                        0.94,  0.05 ],
  ['--accent-foreground',             0.205, 0.03 ],
  ['--border',                        0.88,  0.025],
  ['--input',                         0.88,  0.03 ],
  ['--sidebar',                       0.22,  0.07 ],
  ['--sidebar-foreground',            0.92,  0.02 ],
  ['--sidebar-primary-foreground',    0.985, 0.01 ],
  ['--sidebar-accent',                0.30,  0.07 ],
  ['--sidebar-accent-foreground',     0.98,  0.015],
  ['--sidebar-border',                0.30,  0.05 ],
];

const DARK_AMBIENT: ThemeVar[] = [
  ['--background',                    0.145, 0.02 ],
  ['--foreground',                    0.96,  0.01 ],
  ['--card',                          0.20,  0.03 ],
  ['--card-foreground',               0.96,  0.01 ],
  ['--popover',                       0.20,  0.03 ],
  ['--popover-foreground',            0.96,  0.01 ],
  ['--primary-foreground',            0.15,  0.03 ],
  ['--secondary',                     0.25,  0.04 ],
  ['--secondary-foreground',          0.96,  0.01 ],
  ['--muted',                         0.25,  0.03 ],
  ['--muted-foreground',              0.65,  0.025],
  ['--accent',                        0.28,  0.05 ],
  ['--accent-foreground',             0.96,  0.01 ],
  ['--border',                        0.30,  0.04 ],
  ['--input',                         0.28,  0.04 ],
  ['--sidebar',                       0.16,  0.05 ],
  ['--sidebar-foreground',            0.92,  0.02 ],
  ['--sidebar-primary-foreground',    0.96,  0.01 ],
  ['--sidebar-accent',                0.24,  0.05 ],
  ['--sidebar-accent-foreground',     0.96,  0.01 ],
  ['--sidebar-border',                0.25,  0.04 ],
];

// All variable names that we override (union of ambient + primary) — used for cleanup
const ALL_VARS = [...new Set([
  ...LIGHT_AMBIENT.map(([v]) => v),
  ...DARK_AMBIENT.map(([v]) => v),
  ...PRIMARY_VARS,
])];

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Apply a brand color to the document by overriding ALL theme CSS variables.
 * Primary vars (--primary, --ring, etc.) use the EXACT L/C/H from the hex
 * so buttons and links match the picked swatch. Ambient vars (background,
 * borders, sidebar, etc.) rotate only the hue to shift the overall palette.
 * Pass null to revert to CSS defaults.
 */
export function applyBrandColor(hex: string | null): void {
  const root = document.documentElement;

  if (!hex || !HEX_RE.test(hex)) {
    // Remove all overrides — fall back to CSS defaults
    for (const v of ALL_VARS) root.style.removeProperty(v);
    return;
  }

  const { L: brandL, C: brandC, H } = hexToOklch(hex);
  const ambient = isDark() ? DARK_AMBIENT : LIGHT_AMBIENT;

  // Primary vars: exact color from the picked hex
  for (const varName of PRIMARY_VARS) {
    root.style.setProperty(varName, `oklch(${brandL} ${brandC} ${H.toFixed(1)})`);
  }

  // Ambient vars: fixed L/C, only hue rotated
  for (const [varName, L, C] of ambient) {
    root.style.setProperty(varName, `oklch(${L} ${C} ${H.toFixed(1)})`);
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
