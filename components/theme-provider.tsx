"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";
import { presetThemeColor } from "@/lib/theme-presets";
import {
  buildCustomThemeVars,
  customThemeColorScheme,
  CUSTOM_THEME_VAR_NAMES,
  DEFAULT_CUSTOM_THEME,
} from "@/lib/custom-theme";
import type { AppearancePreset } from "@/lib/types";

function applyThemeColor(preset: AppearancePreset, customBackground?: string) {
  const color = preset === "custom" ? customBackground ?? presetThemeColor.custom : presetThemeColor[preset];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", color);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preset = useDatebookStore((s) => s.settings.preset);
  const density = useDatebookStore((s) => s.settings.density);
  const customTheme = useDatebookStore((s) => s.settings.customTheme);

  useEffect(() => {
    // The settings UI already flips this attribute synchronously on click for an
    // instant repaint; this effect is the reconciler for the other paths
    // (first load, a preset change synced from another device). Skip the DOM
    // write when it's already correct so it can't trigger a redundant recalc.
    const root = document.documentElement;
    if (root.getAttribute("data-preset") !== preset) {
      root.setAttribute("data-preset", preset);
    }
    if (preset === "custom") {
      const colors = customTheme ?? DEFAULT_CUSTOM_THEME;
      const vars = buildCustomThemeVars(colors);
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.style.setProperty("color-scheme", customThemeColorScheme(colors));
      applyThemeColor(preset, colors.background);
    } else {
      for (const name of CUSTOM_THEME_VAR_NAMES) root.style.removeProperty(name);
      root.style.removeProperty("color-scheme");
      applyThemeColor(preset);
    }
  }, [preset, customTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-density") !== density) {
      root.setAttribute("data-density", density);
    }
  }, [density]);

  return <>{children}</>;
}

/** Inline, blocking script to set the preset before first paint — avoids a flash of the default theme.
 *  Ports the same math as `buildCustomThemeVars` in lib/custom-theme.ts (kept in sync by hand — this
 *  runs before any bundle is parsed, so it can't import that module) so a reload on the Custom preset
 *  paints the right colors immediately instead of flashing the default theme and then correcting. */
export const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem("datebook-store");
    if (!raw) return;
    var parsed = JSON.parse(raw);
    var settings = parsed && parsed.state && parsed.state.settings;
    var preset = settings && settings.preset;
    var density = settings && settings.density;
    var root = document.documentElement;
    if (preset) root.setAttribute("data-preset", preset);
    if (density) root.setAttribute("data-density", density);
    root.setAttribute("data-first-load", "1");
    window.addEventListener("load", function () {
      root.removeAttribute("data-first-load");
    }, { once: true });

    var themeColor = ${JSON.stringify(presetThemeColor)}[preset];

    if (preset === "custom") {
      var c = (settings && settings.customTheme) || ${JSON.stringify(DEFAULT_CUSTOM_THEME)};
      function hexToRgb(hex) {
        var h = hex.replace("#", "");
        if (h.length === 3) h = h.replace(/./g, function (ch) { return ch + ch; });
        var n = parseInt(h.slice(0, 6), 16) || 0;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      function clampByte(v) { return Math.min(255, Math.max(0, Math.round(v))); }
      function toHex(rgb) {
        return "#" + rgb.map(function (v) { return clampByte(v).toString(16).padStart(2, "0"); }).join("");
      }
      function mix(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      function luminance(rgb) {
        var s = rgb.map(function (v) {
          var x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      }
      function rgba(rgb, a) {
        return "rgba(" + clampByte(rgb[0]) + ", " + clampByte(rgb[1]) + ", " + clampByte(rgb[2]) + ", " + a + ")";
      }
      var bg = hexToRgb(c.background), surface = hexToRgb(c.surface), accent = hexToRgb(c.accent);
      // Keyed off surface, not background — text and borders overwhelmingly
      // render on surface cards, not the page backdrop, so a dark background
      // paired with a light surface still needs light-mode ink (see the
      // matching comment on customThemeColorScheme in lib/custom-theme.ts).
      var dark = luminance(surface) <= 0.5;
      var white = [255, 255, 255], black = [0, 0, 0];
      var ink = dark ? [244, 244, 245] : [28, 28, 30];
      var accentIsLight = luminance(accent) > 0.5;
      var vars = {
        "--surface-base": c.background,
        "--surface": c.surface,
        "--surface-elevated": dark ? toHex(mix(surface, white, 0.06)) : c.surface,
        "--surface-sunken": toHex(mix(surface, bg, 0.55)),
        "--surface-floating": rgba(surface, dark ? 0.65 : 0.75),
        "--line": toHex(mix(surface, ink, dark ? 0.12 : 0.1)),
        "--line-strong": toHex(mix(surface, ink, dark ? 0.22 : 0.18)),
        "--ink": toHex(ink),
        "--ink-soft": toHex(mix(ink, bg, dark ? 0.42 : 0.34)),
        "--ink-faint": toHex(mix(ink, bg, dark ? 0.66 : 0.58)),
        "--accent": c.accent,
        "--accent-2": toHex(mix(accent, dark ? white : black, 0.22)),
        "--accent-ink": accentIsLight ? "#1c1c1e" : "#ffffff",
        "--accent-soft": toHex(mix(surface, accent, dark ? 0.22 : 0.12)),
        "--warn": dark ? "#e3a85c" : "#c93400",
        "--good": dark ? "#5fd0a0" : "#248a3d",
        "--shadow-sm": dark ? "0 1px 2px rgba(0, 0, 0, 0.4)" : "0 1px 2px rgba(0, 0, 0, 0.08)",
        "--shadow-md": dark ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 6px 20px rgba(0, 0, 0, 0.1)",
        "--shadow-lg": dark ? "0 24px 60px rgba(0, 0, 0, 0.55)" : "0 20px 48px rgba(0, 0, 0, 0.14)",
        "--ambient": "none",
      };
      vars["--warn-soft"] = toHex(mix(surface, hexToRgb(vars["--warn"]), dark ? 0.18 : 0.12));
      vars["--good-soft"] = toHex(mix(surface, hexToRgb(vars["--good"]), dark ? 0.18 : 0.12));
      for (var name in vars) root.style.setProperty(name, vars[name]);
      root.style.colorScheme = dark ? "dark" : "light";
      themeColor = c.background;
    }

    if (themeColor) {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", themeColor);
    }
  } catch (e) {}
})();
`;
