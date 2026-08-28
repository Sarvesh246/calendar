import type { AppearancePreset } from "./types";

export const presetMeta: Record<
  AppearancePreset,
  { label: string; description: string; swatch: [string, string, string] }
> = {
  minimal: {
    label: "Minimal",
    description: "Clean, monochrome, low visual noise.",
    swatch: ["#f7f7f8", "#ffffff", "#565fc2"],
  },
  midnight: {
    label: "Midnight",
    description: "Dark background, vibrant category accents.",
    swatch: ["#0b0b0d", "#151518", "#8b7cff"],
  },
  paper: {
    label: "Paper",
    description: "Warm off-white, softer borders, serif headings.",
    swatch: ["#f6efe2", "#fffdf8", "#7a3b32"],
  },
  aurora: {
    label: "Aurora",
    description: "Subtle gradients and colorful surfaces.",
    swatch: ["#f5f3ff", "#ffffff", "#7c5cf0"],
  },
  mono: {
    label: "Mono",
    description: "Black and white, category colors used sparingly.",
    swatch: ["#000000", "#0a0a0a", "#ffffff"],
  },
  noir: {
    label: "Noir",
    description: "Warm near-black with a brass accent — editorial.",
    swatch: ["#0c0b0a", "#16140f", "#c9a24a"],
  },
  sakura: {
    label: "Sakura",
    description: "Soft warm white with a rose blush.",
    swatch: ["#fdf2f4", "#fffafb", "#c2456b"],
  },
  evergreen: {
    label: "Evergreen",
    description: "Deep forest dark with a mint accent.",
    swatch: ["#0a0f0c", "#101713", "#57c98b"],
  },
  slate: {
    label: "Slate",
    description: "Cool grey, steel-blue accent, crisp.",
    swatch: ["#eef1f4", "#ffffff", "#3d6ea5"],
  },
  ember: {
    label: "Ember",
    description: "Charcoal with a warm coral glow.",
    swatch: ["#100d0c", "#1a1513", "#f0704a"],
  },
  frost: {
    label: "Frost",
    description: "Pale arctic blue, glacier accent, airy.",
    swatch: ["#eef4f8", "#ffffff", "#2b8fb8"],
  },
};

/** Surface-base color for `theme-color` / the iOS status bar chrome. */
export const presetThemeColor: Record<AppearancePreset, string> = {
  minimal: "#f7f7f8",
  midnight: "#0b0b0d",
  paper: "#f6efe2",
  aurora: "#f5f3ff",
  mono: "#000000",
  noir: "#0c0b0a",
  sakura: "#fdf2f4",
  evergreen: "#0a0f0c",
  slate: "#eef1f4",
  ember: "#100d0c",
  frost: "#eef4f8",
};

export const presetOrder: AppearancePreset[] = [
  "minimal",
  "midnight",
  "paper",
  "aurora",
  "mono",
  "noir",
  "sakura",
  "evergreen",
  "slate",
  "ember",
  "frost",
];
