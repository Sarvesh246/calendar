export type ItemType = "event" | "assignment" | "task";
export type ItemStatus = "todo" | "doing" | "done";

export interface Category {
  id: string;
  name: string;
  color: string; // base hex, e.g. "#7C6CFF" — surface/border/text derived via color-mix
  icon?: string;
  archived?: boolean;
  /** Set when auto-created for an imported feed; cleaned up when that feed is removed. */
  sourceId?: string;
}

export interface Reminder {
  id: string;
  itemId: string;
  offsetMinutes: number; // minutes before startAt/dueAt
  label: string; // e.g. "1 day before"
}

export interface Item {
  id: string;
  categoryId: string;
  type: ItemType;
  title: string;
  description?: string;
  location?: string;
  /** ISO datetime. Events use this as the start time; assignments/tasks use it as the due time. */
  at: string;
  endAt?: string;
  allDay?: boolean;
  status?: ItemStatus; // assignments/tasks only
  reminders?: Reminder[];
  createdAt: string;
  /** Set when the item came from an imported calendar feed (see ImportSource.id). */
  sourceId?: string;
  /** The feed's own UID for this event — used to match on re-sync instead of duplicating. */
  sourceUid?: string;
}

/** A subscribed calendar feed (Canvas, Google, Outlook, …) the items were imported from. */
export interface ImportSource {
  id: string;
  url: string;
  name: string;
  addedAt: string;
  lastSyncedAt: string;
  itemCount: number;
}

export type AppearancePreset = "minimal" | "midnight" | "paper" | "aurora" | "mono";
export type LandingView = "today" | "calendar" | "agenda";
export type Density = "compact" | "comfortable" | "spacious";

export interface ReminderPreset {
  id: string;
  label: string;
  offsetMinutes: number;
}

export interface UserSettings {
  preset: AppearancePreset;
  landingView: LandingView;
  density: Density;
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  clock24h: boolean;
  showLocation: boolean;
  showCategoryDot: boolean;
  defaultReminderPresetIds: string[];
}
