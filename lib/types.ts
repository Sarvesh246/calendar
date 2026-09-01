export type ItemType = "event" | "assignment" | "task";
export type ItemStatus = "todo" | "doing" | "done";
export type RepeatFreq = "daily" | "weekly" | "monthly";

export interface RepeatRule {
  freq: RepeatFreq;
  /** 1 = every period. Capped at 30 when expanding. */
  interval?: number;
  /** 0 = Sunday … 6 = Saturday. Weekly only. */
  byDay?: number[];
  /** ISO datetime — last occurrence is on or before this instant. */
  until?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string; // base hex, e.g. "#007AFF"
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

/** Last imported values for a feed item — used so a re-sync keeps local edits. */
export type SourceSnapshot = Pick<
  Item,
  "title" | "description" | "location" | "url" | "at" | "endAt" | "allDay" | "type" | "categoryId"
>;

export interface Item {
  id: string;
  categoryId: string;
  type: ItemType;
  title: string;
  description?: string;
  location?: string;
  /** External link for the item — e.g. the Canvas assignment page from an imported feed. */
  url?: string;
  /** ISO datetime. Events use this as the start time; assignments/tasks use it as the due time. */
  at: string;
  endAt?: string;
  allDay?: boolean;
  status?: ItemStatus; // assignments/tasks only
  /** Set when the item was marked done (not the due date). */
  completedAt?: string;
  reminders?: Reminder[];
  createdAt: string;
  /** Recurrence for a user-created series. Copied onto every expanded instance. */
  repeat?: RepeatRule;
  /** Shared id for every instance in a user-created series. */
  repeatId?: string;
  /** Set when the item came from an imported calendar feed (see ImportSource.id). */
  sourceId?: string;
  /** The feed's own UID for this event — used to match on re-sync instead of duplicating. */
  sourceUid?: string;
  /** Feed field values from the last sync; local edits to those fields are preserved. */
  sourceSnapshot?: SourceSnapshot;
}

/** A subscribed calendar feed (Canvas, Google, Outlook, …) the items were imported from. */
export interface ImportSource {
  id: string;
  url: string;
  name: string;
  addedAt: string;
  lastSyncedAt: string;
  itemCount: number;
  /** Set when the last background or manual sync failed. Cleared on success. */
  lastError?: string;
}

export type AppearancePreset =
  | "minimal"
  | "midnight"
  | "paper"
  | "aurora"
  | "mono"
  | "noir"
  | "sakura"
  | "evergreen"
  | "slate"
  | "ember"
  | "frost";
export type LandingView = "today" | "calendar" | "agenda";
export type Density = "compact" | "comfortable" | "spacious";
/** How tapping a day on mobile calendar shows that day's items. */
export type MobileDayDetails = "sheet" | "inline";

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
  hideCompleted: boolean;
  defaultReminderPresetIds: string[];
  /** Mobile calendar: pop-up panel vs list below the month grid. */
  mobileDayDetails: MobileDayDetails;
  /** Hide the first-run empty-state card. */
  onboardingDismissed?: boolean;
}
