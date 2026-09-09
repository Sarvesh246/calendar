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
