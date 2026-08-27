export type ItemType = "event" | "assignment" | "task";
export type ItemStatus = "todo" | "doing" | "done";

export interface Category {
  id: string;
  name: string;
  color: string; // base hex, e.g. "#7C6CFF" — surface/border/text derived via color-mix
  icon?: string;
  archived?: boolean;
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
