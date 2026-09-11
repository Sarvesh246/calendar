import type { AppearancePreset, Density, UserSettings } from "@/lib/types";

export const APPEARANCE_STORAGE_KEY = "datebook-appearance";

export type AppearanceSnapshot = {
  preset?: AppearancePreset;
  density?: Density;
  customTheme?: UserSettings["customTheme"];
};

export function writeAppearanceSnapshot(
  settings: Pick<UserSettings, "preset" | "density" | "customTheme">
) {
  try {
    const snapshot: AppearanceSnapshot = {
      preset: settings.preset,
      density: settings.density,
    };
    if (settings.customTheme) snapshot.customTheme = settings.customTheme;
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

export function readAppearanceSnapshot(): AppearanceSnapshot | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppearanceSnapshot;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
