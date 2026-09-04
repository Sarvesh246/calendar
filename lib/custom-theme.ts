/**
 * Derives a full Datebook palette from the three colors a user picks for the
 * "Custom" appearance preset — background, surface (cards), and accent — the
 * same three swatches every built-in preset is shown as in Settings. Every
 * other token (ink, lines, warn/good, shadows…) is computed from those three
 * so a custom theme reads as coherent as a hand-tuned one instead of a raw
 * color-picker result.
 */

export interface CustomThemeColors {
  background: string;
  surface: string;
  accent: string;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  background: "#f3f0ff",
  surface: "#ffffff",
  accent: "#7c5cf0",
};

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const num = parseInt(full.slice(0, 6), 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("");
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const s = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

/** True if `hex` reads as a light color — the same test used to decide body
 *  text color and `color-scheme` for a custom background or accent. */
export function isLightColor(hex: string): boolean {
  return relativeLuminance(hexToRgb(hex)) > 0.5;
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${alpha})`;
}

/** Ink, lines, and every other content-adjacent token are pinned to `surface`
 *  rather than `background` — text overwhelmingly renders on `bg-surface`
 *  cards, not the page backdrop, so a dark background paired with a light
 *  surface (a perfectly reasonable pick) needs *light-mode* ink, not dark. */
export function customThemeColorScheme(colors: CustomThemeColors): "light" | "dark" {
  return isLightColor(colors.surface) ? "light" : "dark";
}

/** Full set of CSS custom properties (matching the built-in `:root[data-preset]`
 *  blocks in globals.css) that a custom theme needs applied inline, since its
 *  values can't be known ahead of time as static CSS. */
export function buildCustomThemeVars(colors: CustomThemeColors): Record<string, string> {
  const bg = hexToRgb(colors.background);
  const surface = hexToRgb(colors.surface);
  const accent = hexToRgb(colors.accent);
  const dark = !isLightColor(colors.surface);
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];

  const ink: Rgb = dark ? [244, 244, 245] : [28, 28, 30];
  const inkSoft = mix(ink, bg, dark ? 0.42 : 0.34);
  const inkFaint = mix(ink, bg, dark ? 0.66 : 0.58);

  // Mixed from `surface` (not `background`) for the same reason as `dark`
  // above — borders overwhelmingly outline surface cards, not the page.
  const line = mix(surface, ink, dark ? 0.12 : 0.1);
  const lineStrong = mix(surface, ink, dark ? 0.22 : 0.18);

  const surfaceElevated = dark ? mix(surface, white, 0.06) : surface;
  const surfaceSunken = mix(surface, bg, 0.55);

  const accentIsLight = isLightColor(colors.accent);
  const accentInk = accentIsLight ? "#1c1c1e" : "#ffffff";
  const accent2 = mix(accent, dark ? white : black, 0.22);
  const accentSoft = mix(surface, accent, dark ? 0.22 : 0.12);

  const warn: Rgb = dark ? [227, 168, 92] : [201, 52, 0];
  const good: Rgb = dark ? [95, 208, 160] : [36, 138, 61];
  const warnSoft = mix(surface, warn, dark ? 0.18 : 0.12);
  const goodSoft = mix(surface, good, dark ? 0.18 : 0.12);

  return {
    "--surface-base": colors.background,
    "--surface": colors.surface,
    "--surface-elevated": rgbToHex(surfaceElevated),
    "--surface-sunken": rgbToHex(surfaceSunken),
    "--surface-floating": rgba(surface, dark ? 0.65 : 0.75),
    "--line": rgbToHex(line),
    "--line-strong": rgbToHex(lineStrong),
    "--ink": rgbToHex(ink),
    "--ink-soft": rgbToHex(inkSoft),
    "--ink-faint": rgbToHex(inkFaint),
    "--accent": colors.accent,
    "--accent-2": rgbToHex(accent2),
    "--accent-ink": accentInk,
    "--accent-soft": rgbToHex(accentSoft),
    "--warn": rgbToHex(warn),
    "--warn-soft": rgbToHex(warnSoft),
    "--good": rgbToHex(good),
    "--good-soft": rgbToHex(goodSoft),
    "--shadow-sm": dark ? "0 1px 2px rgba(0, 0, 0, 0.4)" : "0 1px 2px rgba(0, 0, 0, 0.08)",
    "--shadow-md": dark ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 6px 20px rgba(0, 0, 0, 0.1)",
    "--shadow-lg": dark ? "0 24px 60px rgba(0, 0, 0, 0.55)" : "0 20px 48px rgba(0, 0, 0, 0.14)",
    "--ambient": "none",
  };
}

/** Every CSS variable a custom theme can set inline — used to clear them
 *  cleanly when switching away, since an inline style always outranks the
 *  static `:root[data-preset]` rules a built-in preset relies on. */
export const CUSTOM_THEME_VAR_NAMES = Object.keys(buildCustomThemeVars(DEFAULT_CUSTOM_THEME));
