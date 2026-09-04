import { DEFAULT_CUSTOM_THEME } from "./custom-theme";
import type { AppearancePreset } from "./types";

export const presetMeta: Record<
  AppearancePreset,
  { label: string; description: string; swatch: [string, string, string] }
> = {
  minimal: {
    label: "Minimal",
    description: "Neutral grey surfaces with a system blue accent.",
    swatch: ["#f2f2f7", "#fafafa", "#007aff"],
  },
  slate: {
    label: "Slate",
    description: "Cool grey with a steel-blue accent.",
    swatch: ["#eef1f4", "#fafafa", "#3d6ea5"],
  },
  paper: {
    label: "Paper",
    description: "Warm off-white with a muted brown accent.",
    swatch: ["#f6efe2", "#fffdf8", "#7a3b32"],
  },
  frost: {
    label: "Frost",
    description: "Pale blue-grey with a glacier accent.",
    swatch: ["#eef4f8", "#fafafa", "#2b8fb8"],
  },
  midnight: {
    label: "Midnight",
    description: "Dark grey surfaces with a blue accent.",
    swatch: ["#1c1c1e", "#2c2c2e", "#0a84ff"],
  },
  evergreen: {
    label: "Evergreen",
    description: "Forest dark with a muted green accent.",
    swatch: ["#0a0f0c", "#101713", "#57c98b"],
  },
  noir: {
    label: "Noir",
    description: "Warm near-black with a brass accent.",
    swatch: ["#0c0b0a", "#16140f", "#c9a24a"],
  },
  ember: {
    label: "Ember",
    description: "Charcoal with a warm coral accent.",
    swatch: ["#100d0c", "#1a1513", "#f0704a"],
  },
  sakura: {
    label: "Sakura",
    description: "Soft rose tint on warm white.",
    swatch: ["#fdf2f4", "#fffafb", "#c2456b"],
  },
  aurora: {
    label: "Aurora",
    description: "Cool grey with a steel accent.",
    swatch: ["#eef1f4", "#f8f9fb", "#3d6ea5"],
  },
  mono: {
    label: "Mono",
    description: "High-contrast black and white.",
    swatch: ["#000000", "#0a0a0a", "#fafafa"],
  },
  custom: {
    label: "Custom",
    description: "Pick your own background, surface, and accent.",
    swatch: [DEFAULT_CUSTOM_THEME.background, DEFAULT_CUSTOM_THEME.surface, DEFAULT_CUSTOM_THEME.accent],
  },
};

export const presetThemeColor: Record<AppearancePreset, string> = {
  minimal: "#f2f2f7",
  slate: "#eef1f4",
  paper: "#f6efe2",
  frost: "#eef4f8",
  midnight: "#1c1c1e",
  evergreen: "#0a0f0c",
  noir: "#0c0b0a",
  ember: "#100d0c",
  sakura: "#fdf2f4",
  aurora: "#eef1f4",
  mono: "#000000",
  custom: DEFAULT_CUSTOM_THEME.background,
};

export const presetOrder: AppearancePreset[] = [
  "minimal",
  "slate",
  "paper",
  "frost",
  "midnight",
  "evergreen",
  "noir",
  "ember",
  "sakura",
  "aurora",
  "mono",
  "custom",
];
