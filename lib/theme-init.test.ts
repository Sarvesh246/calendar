import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { themeInitScript } from "@/components/theme-provider";
import { buildCustomThemeVars, customThemeColorScheme } from "@/lib/custom-theme";

describe("first-paint custom theme", () => {
  it.each([
    { background: "#07110c", surface: "#101a14", accent: "#4cba82" },
    { background: "#f0e6d4", surface: "#fffaf2", accent: "#8f4a3c" },
    { background: "#808080", surface: "#8a8a8a", accent: "#ff0000" },
  ])("matches the hydrated palette for $surface", (colors) => {
    const props: Record<string, string> = {};
    const root = {
      style: {
        setProperty: (key: string, value: string) => {
          props[key] = value;
        },
        colorScheme: "",
      },
      setAttribute: () => {},
      removeAttribute: () => {},
    };
    runInNewContext(themeInitScript, {
      localStorage: { getItem: () => JSON.stringify({ preset: "custom", customTheme: colors }) },
      document: { documentElement: root, querySelectorAll: () => [] },
      window: { addEventListener: () => {} },
    });
    expect(props).toEqual(buildCustomThemeVars(colors));
    expect(root.style.colorScheme).toBe(customThemeColorScheme(colors));
  });
});
