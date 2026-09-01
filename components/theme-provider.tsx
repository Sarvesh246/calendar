"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";
import { presetThemeColor } from "@/lib/theme-presets";
import type { AppearancePreset } from "@/lib/types";

function applyThemeColor(preset: AppearancePreset) {
  const color = presetThemeColor[preset];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", color);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preset = useDatebookStore((s) => s.settings.preset);
  const density = useDatebookStore((s) => s.settings.density);

  useEffect(() => {
    // The settings UI already flips this attribute synchronously on click for an
    // instant repaint; this effect is the reconciler for the other paths
    // (first load, a preset change synced from another device). Skip the DOM
    // write when it's already correct so it can't trigger a redundant recalc.
    if (document.documentElement.getAttribute("data-preset") !== preset) {
      document.documentElement.setAttribute("data-preset", preset);
    }
    applyThemeColor(preset);
  }, [preset]);

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-density") !== density) {
      root.setAttribute("data-density", density);
    }
  }, [density]);

  return <>{children}</>;
}

/** Inline, blocking script to set the preset before first paint — avoids a flash of the default theme. */
export const themeInitScript = `
(function () {
  try {
    var preset;
    var density;
    try {
      var appearance = localStorage.getItem("datebook-appearance");
      if (appearance) {
        var a = JSON.parse(appearance);
        if (a) {
          preset = a.preset;
          density = a.density;
        }
      }
    } catch (e) {}
    if (!preset) {
      var raw = localStorage.getItem("datebook-store");
      if (raw) {
        var parsed = JSON.parse(raw);
        var settings = parsed && parsed.state && parsed.state.settings;
        preset = settings && settings.preset;
        density = density || (settings && settings.density);
      }
    }
    if (preset) document.documentElement.setAttribute("data-preset", preset);
    if (density) document.documentElement.setAttribute("data-density", density);
    document.documentElement.setAttribute("data-first-load", "1");
    window.addEventListener("load", function () {
      document.documentElement.removeAttribute("data-first-load");
    }, { once: true });
    if (preset) {
      var colors = ${JSON.stringify(presetThemeColor)};
      var color = colors[preset];
      if (color) {
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
      }
    }
  } catch (e) {}
})();
`;
