import { presetOrder } from "./theme-presets";
import type {
  AppearancePreset,
  Category,
  Density,
  LandingView,
  MobileDayDetails,
  UserSettings,
} from "./types";

export const defaultUserSettings: UserSettings = {
  preset: "minimal",
  landingView: "today",
  density: "comfortable",
  weekStartsOn: 0,
  clock24h: false,
  showLocation: true,
  showCategoryDot: true,
  hideCompleted: false,
  defaultReminderPresetIds: ["rp-night"],
  mobileDayDetails: "sheet",
};

const PRESETS = new Set<string>(presetOrder);

export function isAppearancePreset(value: unknown): value is AppearancePreset {
  return typeof value === "string" && PRESETS.has(value);
}

function landingView(value: unknown, fallback: LandingView): LandingView {
  return value === "today" || value === "calendar" || value === "agenda" ? value : fallback;
}

function density(value: unknown, fallback: Density): Density {
  return value === "compact" || value === "comfortable" || value === "spacious" ? value : fallback;
}

function mobileDayDetails(value: unknown, fallback: MobileDayDetails): MobileDayDetails {
  return value === "inline" || value === "sheet" ? value : fallback;
}

/**
 * Fill gaps and drop invalid appearance values so a partial/corrupt cloud row
 * or localStorage blob cannot reset the theme to the factory default.
 */
export function normalizeSettings(
  incoming: Partial<UserSettings> | null | undefined,
  fallback: UserSettings = defaultUserSettings
): UserSettings {
  const src = incoming && typeof incoming === "object" ? incoming : {};
  return {
    preset: isAppearancePreset(src.preset) ? src.preset : fallback.preset,
    landingView: landingView(src.landingView, fallback.landingView),
    density: density(src.density, fallback.density),
    weekStartsOn: src.weekStartsOn === 1 ? 1 : src.weekStartsOn === 0 ? 0 : fallback.weekStartsOn,
    clock24h: typeof src.clock24h === "boolean" ? src.clock24h : fallback.clock24h,
    showLocation: typeof src.showLocation === "boolean" ? src.showLocation : fallback.showLocation,
    showCategoryDot:
      typeof src.showCategoryDot === "boolean" ? src.showCategoryDot : fallback.showCategoryDot,
    hideCompleted: typeof src.hideCompleted === "boolean" ? src.hideCompleted : fallback.hideCompleted,
    defaultReminderPresetIds: Array.isArray(src.defaultReminderPresetIds)
      ? src.defaultReminderPresetIds.filter((id) => typeof id === "string")
      : fallback.defaultReminderPresetIds,
    mobileDayDetails: mobileDayDetails(src.mobileDayDetails, fallback.mobileDayDetails),
    ...(src.onboardingDismissed || fallback.onboardingDismissed
      ? { onboardingDismissed: Boolean(src.onboardingDismissed ?? fallback.onboardingDismissed) }
      : {}),
  };
}

export function categoryName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sanitizeCategories(cats: unknown): Category[] {
  if (!Array.isArray(cats)) return [];
  const out: Category[] = [];
  for (const raw of cats) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Partial<Category>;
    if (typeof c.id !== "string" || !c.id) continue;
    out.push({
      id: c.id,
      name: categoryName(c.name) || "Untitled",
      color: typeof c.color === "string" && c.color ? c.color : "#8E8E93",
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.archived ? { archived: true } : {}),
      ...(c.sourceId ? { sourceId: c.sourceId } : {}),
    });
  }
  return out;
}
