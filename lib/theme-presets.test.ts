import { describe, expect, it } from "vitest";
import { presetMeta, presetOrder, presetThemeColor } from "./theme-presets";

describe("theme presets", () => {
  it("covers every ordered preset with matching swatches and theme-color", () => {
    for (const preset of presetOrder) {
      expect(presetMeta[preset]).toBeTruthy();
      expect(presetThemeColor[preset]).toBe(presetMeta[preset].swatch[0]);
    }
  });

  it("gives each built-in a distinct background/surface/accent trio", () => {
    const builtIn = presetOrder.filter((p) => p !== "custom");
    const keys = builtIn.map((p) => presetMeta[p].swatch.join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the light neutrals from cloning each other", () => {
    const { minimal, slate, frost, paper, aurora, sakura } = presetMeta;
    expect(minimal.swatch[0]).not.toBe(slate.swatch[0]);
    expect(minimal.swatch[0]).not.toBe(frost.swatch[0]);
    expect(slate.swatch[0]).not.toBe(frost.swatch[0]);
    expect(minimal.swatch[1]).toBe("#ffffff");
    expect(slate.swatch[1]).not.toBe("#ffffff");
    expect(frost.swatch[0].toLowerCase()).not.toBe(paper.swatch[0].toLowerCase());
    expect(aurora.swatch[2]).not.toBe(slate.swatch[2]);
    expect(sakura.swatch[0]).not.toBe(minimal.swatch[0]);
  });
});
