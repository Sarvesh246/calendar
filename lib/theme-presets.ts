import { DEFAULT_CUSTOM_THEME } from "./custom-theme";
import type { AppearancePreset } from "./types";

export const presetMeta: Record<
  AppearancePreset,
  { label: string; description: string; swatch: [string, string, string] }
> = {
  minimal: {
    label: "Minimal",
    description: "iOS grouped light — grey canvas, white cards, system blue.",
    swatch: ["#f2f2f7", "#ffffff", "#007aff"],
  },
  slate: {
    label: "Slate",
    description: "Denser graphite surfaces with a steel accent.",
    swatch: ["#d8dee6", "#e9edf2", "#3d556c"],
  },
  paper: {
    label: "Paper",
    description: "Warm notebook cream with terracotta.",
    swatch: ["#f0e6d4", "#fffaf2", "#8f4a3c"],
  },
  frost: {
    label: "Frost",
    description: "Icy blue wash with a glacier accent.",
    swatch: ["#d5eef6", "#f3fbfd", "#1788ab"],
  },
  midnight: {
    label: "Midnight",
    description: "iOS grouped dark with system blue.",
    swatch: ["#000000", "#1c1c1e", "#0a84ff"],
  },
  evergreen: {
    label: "Evergreen",
    description: "Forest dark with a muted mint accent.",
    swatch: ["#07110c", "#101a14", "#4cba82"],
  },
  noir: {
    label: "Noir",
    description: "Warm near-black with a brass accent.",
    swatch: ["#0c0b0a", "#16140f", "#c9a24a"],
  },
  ember: {
    label: "Ember",
    description: "Warm charcoal with a restrained coral.",
    swatch: ["#120e0c", "#1c1613", "#e56b48"],
  },
  sakura: {
    label: "Sakura",
    description: "Rose wash on warm paper.",
    swatch: ["#f8e8ec", "#fff8f9", "#c2456b"],
  },
  aurora: {
    label: "Aurora",
    description: "Lilac canvas with a violet accent.",
    swatch: ["#eee9fb", "#fbfaff", "#6d4ee8"],
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
  slate: "#d8dee6",
  paper: "#f0e6d4",
  frost: "#d5eef6",
  midnight: "#000000",
  evergreen: "#07110c",
  noir: "#0c0b0a",
  ember: "#120e0c",
  sakura: "#f8e8ec",
  aurora: "#eee9fb",
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
