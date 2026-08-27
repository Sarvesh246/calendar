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
};

export const presetOrder: AppearancePreset[] = ["minimal", "midnight", "paper", "aurora", "mono"];
