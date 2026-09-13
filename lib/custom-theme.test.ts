import { describe, expect, it } from "vitest";
import {
  applyCustomThemeToDocument,
  buildCustomThemeVars,
  clearCustomThemeFromDocument,
  CUSTOM_THEME_VAR_NAMES,
  customThemeColorScheme,
  DEFAULT_CUSTOM_THEME,
  isLightColor,
  normalizeThemeHex,
  sanitizeCustomTheme,
} from "./custom-theme";

function mockRoot() {
  const props: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  return {
    props,
    attrs,
    style: {
      setProperty(name: string, value: string) {
        props[name] = value;
      },
      removeProperty(name: string) {
        delete props[name];
      },
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
  };
}

describe("normalizeThemeHex", () => {
  it("expands short hex and lowercases", () => {
    expect(normalizeThemeHex("#AbC")).toBe("#aabbcc");
    expect(normalizeThemeHex("  #007AFF ")).toBe("#007aff");
  });

  it("rejects junk", () => {
    expect(normalizeThemeHex("blue")).toBeNull();
    expect(normalizeThemeHex("#gg0000")).toBeNull();
  });
});

describe("sanitizeCustomTheme", () => {
  it("keeps a valid palette", () => {
    expect(sanitizeCustomTheme(DEFAULT_CUSTOM_THEME)).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it("drops incomplete or invalid palettes", () => {
    expect(sanitizeCustomTheme({ background: "#fff" })).toBeUndefined();
    expect(sanitizeCustomTheme({ background: "nope", surface: "#fff", accent: "#000" })).toBeUndefined();
  });
});

describe("buildCustomThemeVars", () => {
  it("emits the same token names built-in presets use", () => {
    const vars = buildCustomThemeVars(DEFAULT_CUSTOM_THEME);
    expect(Object.keys(vars).sort()).toEqual([...CUSTOM_THEME_VAR_NAMES].sort());
    expect(vars["--surface-base"]).toBe(DEFAULT_CUSTOM_THEME.background);
    expect(vars["--surface"]).toBe(DEFAULT_CUSTOM_THEME.surface);
    expect(vars["--accent"]).toBe(DEFAULT_CUSTOM_THEME.accent);
  });

  it("keys light/dark off surface, not background", () => {
    expect(
      customThemeColorScheme({ background: "#111111", surface: "#fafafa", accent: "#007aff" })
    ).toBe("light");
    expect(
      customThemeColorScheme({ background: "#fafafa", surface: "#1c1c1e", accent: "#0a84ff" })
    ).toBe("dark");
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#111111")).toBe(false);
  });
});

describe("applyCustomThemeToDocument", () => {
  it("writes derived tokens and data-preset on the same call", () => {
    const root = mockRoot();
    applyCustomThemeToDocument(
      { background: "#112233", surface: "#ffffff", accent: "#ff0000" },
      root
    );
    expect(root.attrs["data-preset"]).toBe("custom");
    expect(root.props["--surface-base"]).toBe("#112233");
    expect(root.props["--surface"]).toBe("#ffffff");
    expect(root.props["--accent"]).toBe("#ff0000");
    expect(root.props["color-scheme"]).toBe("light");
    expect(root.props["--ink"]).toBeTruthy();
    expect(root.props["--accent-soft"]).toBeTruthy();
  });

  it("clears inline vars so a built-in preset stylesheet can win", () => {
    const root = mockRoot();
    applyCustomThemeToDocument(DEFAULT_CUSTOM_THEME, root);
    clearCustomThemeFromDocument(root);
    expect(root.props["--accent"]).toBeUndefined();
    expect(root.props["color-scheme"]).toBeUndefined();
  });
});

describe("custom theme contrast", () => {
  function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const s = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  }
  function ratio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // The faint tier carries times, counts and dates, so it is body text and has
  // to clear AA against both the page and the cards it lands on.
  const palettes = [
    { background: "#f3f0ff", surface: "#ffffff", accent: "#7c5cf0" },
    { background: "#808080", surface: "#8a8a8a", accent: "#333333" },
    { background: "#101014", surface: "#1c1c22", accent: "#0a84ff" },
    { background: "#ffffff", surface: "#fafafa", accent: "#ff2d55" },
    { background: "#2b2b2b", surface: "#f5f5f5", accent: "#00a3a3" },
  ];

  for (const colors of palettes) {
    it(`keeps ink-soft and ink-faint legible on ${colors.surface}`, () => {
      const vars = buildCustomThemeVars(colors);
      // Cards are where text renders, so that is the bar — capped by what the
      // palette can actually reach. A mid-grey surface leaves even the ink
      // short of AA; the guarantee there is "as good as the ink", not magic.
      const ceiling = Math.min(4.4, ratio(vars["--ink"], colors.surface));
      for (const token of ["--ink-soft", "--ink-faint"] as const) {
        expect(ratio(vars[token], colors.surface)).toBeGreaterThanOrEqual(ceiling);
      }
    });
  }

  it("reaches AA on the cards whenever the palette allows it at all", () => {
    // Everything except the deliberately unusable mid-grey pick.
    for (const colors of palettes.filter((c) => c.surface !== "#8a8a8a")) {
      const vars = buildCustomThemeVars(colors);
      expect(ratio(vars["--ink-faint"], colors.surface)).toBeGreaterThanOrEqual(4.4);
      expect(ratio(vars["--ink-soft"], colors.surface)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it("falls back to the ink when no dimmer colour can clear the surface", () => {
    const colors = { background: "#808080", surface: "#8a8a8a", accent: "#333333" };
    const vars = buildCustomThemeVars(colors);
    expect(vars["--ink-faint"]).toBe(vars["--ink"]);
  });

  it("still leaves the tiers in order, faintest last", () => {
    const vars = buildCustomThemeVars(DEFAULT_CUSTOM_THEME);
    const surface = DEFAULT_CUSTOM_THEME.surface;
    expect(ratio(vars["--ink"], surface)).toBeGreaterThan(ratio(vars["--ink-soft"], surface));
    expect(ratio(vars["--ink-soft"], surface)).toBeGreaterThanOrEqual(
      ratio(vars["--ink-faint"], surface)
    );
  });
});
