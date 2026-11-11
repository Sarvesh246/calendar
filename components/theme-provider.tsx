"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { useDatebookStore } from "@/lib/store";
import { presetThemeColor } from "@/lib/theme-presets";
import {
  applyCustomThemeToDocument,
  clearCustomThemeFromDocument,
  DEFAULT_CUSTOM_THEME,
  createCustomThemeEngine,
} from "@/lib/custom-theme";
import { writeAppearanceSnapshot } from "@/lib/appearance-storage";
import type { AppearancePreset } from "@/lib/types";

function applyThemeColor(preset: AppearancePreset, customBackground?: string) {
  const color =
    preset === "custom" ? (customBackground ?? presetThemeColor.custom) : presetThemeColor[preset];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", color);
  }
}

function subscribeHydration(onStoreChange: () => void) {
  return useDatebookStore.persist.onFinishHydration(onStoreChange);
}

function persistHydrated() {
  return useDatebookStore.persist.hasHydrated();
}

/** Write the active palette to `document.documentElement`.
 *  Custom themes have no static `:root[data-preset="custom"]` rule — tokens
 *  live as inline properties. Built-ins use those static rules, so any leftover
 *  inline custom vars have to be cleared or they outrank the stylesheet. */
export function paintAppearance(
  preset: AppearancePreset,
  customTheme?: { background: string; surface: string; accent: string } | null,
) {
  const root = document.documentElement;
  if (preset === "custom") {
    const colors = customTheme ?? DEFAULT_CUSTOM_THEME;
    applyCustomThemeToDocument(colors, root);
    applyThemeColor(preset, colors.background);
  } else {
    root.setAttribute("data-preset", preset);
    clearCustomThemeFromDocument(root);
    applyThemeColor(preset);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preset = useDatebookStore((s) => s.settings.preset);
  const density = useDatebookStore((s) => s.settings.density);
  const customTheme = useDatebookStore((s) => s.settings.customTheme);
  const hydrated = useSyncExternalStore(subscribeHydration, persistHydrated, () => false);

  useLayoutEffect(() => {
    if (!hydrated) return;
    paintAppearance(preset, customTheme);
    writeAppearanceSnapshot({ preset, density, customTheme });
  }, [hydrated, preset, customTheme, density]);

  useLayoutEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (root.getAttribute("data-density") !== density) {
      root.setAttribute("data-density", density);
    }
  }, [hydrated, density]);

  return <>{children}</>;
}

/** Paint the same palette before hydration to avoid a flash on reload.
 *  The engine is self-contained so its source can run in this blocking script. */
export const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem("datebook-appearance");
    var settings;
    if (raw) {
      settings = JSON.parse(raw);
    } else {
      var store = localStorage.getItem("datebook-store");
      if (!store) return;
      var parsed = JSON.parse(store);
      settings = parsed && parsed.state && parsed.state.settings;
    }
    if (!settings) return;
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
      var candidate = settings && settings.customTheme;
      var valid = candidate && [candidate.background, candidate.surface, candidate.accent].every(function (value) {
        return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
      });
      function normalize(value) {
        var h = value.trim().toLowerCase();
        return h.length === 4 ? "#" + h.slice(1).replace(/./g, function (ch) { return ch + ch; }) : h;
      }
      var c = valid ? { background: normalize(candidate.background), surface: normalize(candidate.surface), accent: normalize(candidate.accent) } : ${JSON.stringify(DEFAULT_CUSTOM_THEME)};
      var engine = (${createCustomThemeEngine.toString()})();
      var vars = engine.buildCustomThemeVars(c);
      for (var name in vars) root.style.setProperty(name, vars[name]);
      root.style.colorScheme = engine.customThemeColorScheme(c);
      themeColor = c.background;
    }

    if (themeColor) {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", themeColor);
    }
  } catch (e) {}
})();
`;
