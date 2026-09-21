import { format } from "date-fns";
import type { Category, ImportSource, Item } from "./types";
import {
  happeningNow,
  isClassStartingSoon,
  leftoverOverdue,
  openWorkDueOnDay,
} from "./date-utils";
import {
  classCountdownWindowMs,
  DEFAULT_CLASS_REMINDER_MINUTES,
  isSynthesizedClassReminder,
} from "./class-reminder";
import { isClassScheduleItem, isClassMeeting } from "./class-schedule";
import { effectiveReminders, reminderBody, reminderKey } from "./reminders";
import type { FocusSession } from "./focus-session";
import { activeSegment, isRunning, itemElapsedMs, sessionElapsedMs } from "./focus-session";

export const NATIVE_REMINDER_CAP = 64;

export interface NativeReminderFire {
  id: string;
  itemId: string;
  title: string;
  body: string;
  fireAt: number | null;
  kind: "time" | "class" | "location";
  place?: { name: string; lat: number; lng: number; radiusMeters: number };
}

export interface NativeWidgetRow {
  id: string;
  title: string;
  subtitle: string;
  color: string;
}

export interface NativeLiveClass {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
  location?: string;
  color: string;
  phase: "soon" | "live";
}

export interface NativeLiveFocus {
  itemId: string;
  title: string;
  running: boolean;
  itemElapsedMs: number;
  sessionElapsedMs: number;
  targetEndsAt: number | null;
  startedAt: number;
  color: string;
}

export type NativeLiveActivityMode = "day" | "upcoming" | "current" | "focus" | "allClear";

/** Compact, privacy-filtered state sent to ActivityKit. Never include notes,
 * attendee data, meeting URLs, or the full calendar in this object. */
export interface NativeLiveActivitySnapshot {
  enabled: boolean;
  eligible: boolean;
  eligibilityReason: string;
  mode: NativeLiveActivityMode;
  title: string;
  subtitle?: string;
  location?: string;
  startDate?: number;
  endDate?: number;
  nextTitle?: string;
  nextDate?: number;
  remainingItemCount: number;
  completedItemCount: number;
  totalItemCount: number;
  accentHex: string;
  hidesPrivateDetails: boolean;
  deepLink: string;
  lastUpdated: number;
  isRunning: boolean;
}

export interface NativeSnapshot {
  clock24h: boolean;
  badge: number;
  reminders: NativeReminderFire[];
  today: NativeWidgetRow[];
  upNext: NativeWidgetRow[];
  assignments: NativeWidgetRow[];
  classes: NativeWidgetRow[];
  liveClass: NativeLiveClass | null;
  liveFocus: NativeLiveFocus | null;
  liveActivity: NativeLiveActivitySnapshot;
  spotlight: { id: string; title: string; subtitle: string; keywords: string[] }[];
  calendarEvents: {
    id: string;
    title: string;
    startsAt: number;
    endsAt: number;
    allDay: boolean;
    location?: string;
    notes?: string;
  }[];
  appleCalendarSync: boolean;
  feeds: { id: string; url: string; name: string }[];
}

function catColor(categories: Category[], id: string) {
  return categories.find((c) => c.id === id)?.color ?? "#8E8E93";
}

function catName(categories: Category[], id: string) {
  return categories.find((c) => c.id === id)?.name ?? "";
}

function timeLabel(iso: string, clock24h: boolean) {
  return format(new Date(iso), clock24h ? "HH:mm" : "h:mm a");
}

function row(item: Item, categories: Category[], subtitle: string): NativeWidgetRow {
  return {
    id: item.id,
    title: item.title,
    subtitle,
    color: catColor(categories, item.categoryId),
  };
}

export function upcomingReminderFires(
  items: Item[],
  clock24h: boolean,
  classReminderMinutes: number,
  now = Date.now(),
  cap = NATIVE_REMINDER_CAP
): NativeReminderFire[] {
  const out: NativeReminderFire[] = [];
  for (const item of items) {
    if (item.status === "done") continue;
    const reminders = effectiveReminders(item, classReminderMinutes);
    if (!reminders.length) continue;
    const at = new Date(item.at).getTime();
    if (Number.isNaN(at)) continue;
    const title = item.type === "event" ? item.title : `Due soon: ${item.title}`;
    const bodyBase = reminderBody(item, clock24h);

    for (const r of reminders) {
      const id = reminderKey(item.id, r.id, r.offsetMinutes);
      if (r.place && Number.isFinite(r.place.lat) && Number.isFinite(r.place.lng)) {
        out.push({
          id,
          itemId: item.id,
          title,
          body: `When you arrive at ${r.place.name} · ${bodyBase}`,
          fireAt: null,
          kind: "location",
          place: {
            name: r.place.name,
            lat: r.place.lat,
            lng: r.place.lng,
            radiusMeters: Math.min(2000, Math.max(50, r.place.radiusMeters ?? 150)),
          },
        });
        continue;
      }
      const fireAt = at - r.offsetMinutes * 60_000;
      if (fireAt <= now) continue;
      out.push({
        id,
        itemId: item.id,
        title,
        body: `${r.label} · ${bodyBase}`,
        fireAt,
        kind: isSynthesizedClassReminder(r) ? "class" : "time",
      });
    }
  }
  return out.sort((a, b) => (a.fireAt ?? 0) - (b.fireAt ?? 0)).slice(0, cap);
}

export function buildNativeSnapshot(opts: {
  items: Item[];
  categories: Category[];
  importSources: ImportSource[];
  clock24h: boolean;
  classReminderMinutes?: number;
  appleCalendarSync?: boolean;
  liveActivityEnabled?: boolean;
  liveActivityPrivacy?: "show" | "hide";
  accentHex?: string;
  focus: FocusSession | null;
  now?: Date;
}): NativeSnapshot {
  const now = opts.now ?? new Date();
  const classMinutes = opts.classReminderMinutes ?? DEFAULT_CLASS_REMINDER_MINUTES;
  const windowMs = classCountdownWindowMs(classMinutes);
  const { items, categories, clock24h } = opts;

  const todayWork = openWorkDueOnDay(items, now);
  const overdue = leftoverOverdue(items, now);
  const badge = overdue.length + todayWork.filter((i) => i.status !== "done").length;

  const todayEvents = items
    .filter((i) => {
      const t = new Date(i.at);
      return (
        t.getFullYear() === now.getFullYear() &&
        t.getMonth() === now.getMonth() &&
        t.getDate() === now.getDate() &&
        i.status !== "done"
      );
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const today = todayEvents.slice(0, 6).map((i) =>
    row(
      i,
      categories,
      i.allDay
        ? "All day"
        : timeLabel(i.at, clock24h) +
          (catName(categories, i.categoryId) ? ` · ${catName(categories, i.categoryId)}` : "")
    )
  );

  const upNext = items
    .filter((i) => i.status !== "done" && new Date(i.at).getTime() > now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 6)
    .map((i) =>
      row(i, categories, `${format(new Date(i.at), "EEE")} · ${i.allDay ? "All day" : timeLabel(i.at, clock24h)}`)
    );

  const assignments = items
    .filter((i) => i.type !== "event" && i.status !== "done")
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 6)
    .map((i) => row(i, categories, `Due ${format(new Date(i.at), "MMM d")}`));

  const classes = items
    .filter(
      (i) =>
        isClassScheduleItem(i) &&
        i.status !== "done" &&
        new Date(i.at).getTime() >= now.getTime() - 2 * 60 * 60_000
    )
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 6)
    .map((i) => row(i, categories, i.allDay ? "All day" : timeLabel(i.at, clock24h)));

  const liveNow = happeningNow(items, now, categories).find((i) =>
    isClassMeeting(i, catName(categories, i.categoryId))
  );
  const soon = items.find((i) => isClassStartingSoon(i, now, windowMs));
  const liveSrc = liveNow ?? soon;
  let liveClass: NativeLiveClass | null = null;
  if (liveSrc) {
    const start = new Date(liveSrc.at).getTime();
    const end = liveSrc.endAt ? new Date(liveSrc.endAt).getTime() : start + 50 * 60_000;
    liveClass = {
      id: liveSrc.id,
      title: liveSrc.title,
      startsAt: start,
      endsAt: end,
      location: liveSrc.location,
      color: catColor(categories, liveSrc.categoryId),
      phase: liveNow && liveNow.id === liveSrc.id ? "live" : "soon",
    };
  }

  let liveFocus: NativeLiveFocus | null = null;
  const focus = opts.focus;
  if (focus?.activeItemId) {
    const item = items.find((i) => i.id === focus.activeItemId);
    const seg = activeSegment(focus);
    const ms = now.getTime();
    if (item && (isRunning(focus) || itemElapsedMs(focus, item.id, ms) > 0)) {
      liveFocus = {
        itemId: item.id,
        title: item.title,
        running: isRunning(focus),
        itemElapsedMs: itemElapsedMs(focus, item.id, ms),
        sessionElapsedMs: sessionElapsedMs(focus, ms),
        targetEndsAt: focus.targetEndsAt,
        startedAt: seg?.startedAt ?? ms,
        color: catColor(categories, item.categoryId),
      };
    }
  }

  const liveActivity = buildLiveActivitySnapshot({
    items,
    categories,
    focus: opts.focus,
    enabled: opts.liveActivityEnabled !== false,
    privacy: opts.liveActivityPrivacy === "hide" ? "hide" : "show",
    accentHex: opts.accentHex ?? "#0A84FF",
    now,
  });

  const spotlight = items
    .filter((i) => i.status !== "done")
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 80)
    .map((i) => ({
      id: i.id,
      title: i.title,
      subtitle: [catName(categories, i.categoryId), format(new Date(i.at), "MMM d")].filter(Boolean).join(" · "),
      keywords: [i.title, catName(categories, i.categoryId), i.location, i.type].filter(Boolean) as string[],
    }));

  const horizon = now.getTime() + 14 * 24 * 60 * 60_000;
  const calendarEvents = items
    .filter((i) => {
      const t = new Date(i.at).getTime();
      return i.status !== "done" && t < horizon && t > now.getTime() - 24 * 60 * 60_000;
    })
    .slice(0, 80)
    .map((i) => {
      const startsAt = new Date(i.at).getTime();
      const endsAt = i.endAt
        ? new Date(i.endAt).getTime()
        : startsAt + (i.allDay ? 24 * 60 * 60_000 : 45 * 60_000);
      return {
        id: i.id,
        title: i.title,
        startsAt,
        endsAt,
        allDay: Boolean(i.allDay),
        location: i.location,
        notes: `datebook:${i.id}`,
      };
    });

  return {
    clock24h,
    badge,
    reminders: upcomingReminderFires(items, clock24h, classMinutes, now.getTime()),
    today,
    upNext,
    assignments,
    classes,
    liveClass,
    liveFocus,
    liveActivity,
    spotlight,
    calendarEvents,
    appleCalendarSync: Boolean(opts.appleCalendarSync),
    feeds: opts.importSources
      .filter((s) => s.url.startsWith("http"))
      .map((s) => ({ id: s.id, url: s.url, name: s.name })),
  };
}

export function buildLiveActivitySnapshot(opts: {
  items: Item[];
  categories: Category[];
  focus: FocusSession | null;
  enabled: boolean;
  privacy: "show" | "hide";
  accentHex: string;
  now: Date;
}): NativeLiveActivitySnapshot {
  const nowMs = opts.now.getTime();
  const hidesPrivateDetails = opts.privacy === "hide";
  const relevantToday = opts.items
    .filter((item) => {
      const at = new Date(item.at);
      return (
        at.getFullYear() === opts.now.getFullYear() &&
        at.getMonth() === opts.now.getMonth() &&
        at.getDate() === opts.now.getDate()
      );
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const openToday = relevantToday.filter((item) => item.status !== "done");
  const completedItemCount = relevantToday.filter((item) => item.status === "done").length;
  const base = {
    enabled: opts.enabled,
    eligible: opts.enabled,
    eligibilityReason: opts.enabled
      ? "Datebook is enabled and a day overview is available."
      : "Show Datebook on Lock Screen is turned off.",
    remainingItemCount: openToday.length,
    completedItemCount,
    totalItemCount: relevantToday.length,
    accentHex: opts.accentHex,
    hidesPrivateDetails,
    lastUpdated: nowMs,
  };

  const focus = opts.focus;
  if (focus?.activeItemId) {
    const item = opts.items.find((candidate) => candidate.id === focus.activeItemId);
    const segment = activeSegment(focus);
    if (item && (isRunning(focus) || itemElapsedMs(focus, item.id, nowMs) > 0)) {
      const endDate = focus.targetEndsAt ?? undefined;
      return {
        ...base,
        mode: "focus",
        title: hidesPrivateDetails ? "Focus session" : item.title,
        subtitle: isRunning(focus) ? "Focus in progress" : "Focus paused",
        startDate: segment?.startedAt ?? nowMs,
        endDate,
        isRunning: isRunning(focus),
        deepLink: "datebook://open?intent=focus",
      };
    }
  }

  const current = relevantToday.find((item) => {
    if (item.status === "done" || item.type !== "event" || item.allDay) return false;
    const start = new Date(item.at).getTime();
    const end = item.endAt ? new Date(item.endAt).getTime() : start + 45 * 60_000;
    return start <= nowMs && end > nowMs;
  });
  const future = openToday.find((item) => new Date(item.at).getTime() > nowMs);

  if (current) {
    const startDate = new Date(current.at).getTime();
    const endDate = current.endAt
      ? new Date(current.endAt).getTime()
      : startDate + 45 * 60_000;
    const next = openToday.find((item) => new Date(item.at).getTime() >= endDate);
    return {
      ...base,
      mode: "current",
      title: hidesPrivateDetails ? "Current event" : current.title,
      subtitle: "Happening now",
      ...(current.location && !hidesPrivateDetails ? { location: current.location } : {}),
      startDate,
      endDate,
      ...(next
        ? {
            nextTitle: hidesPrivateDetails ? "Upcoming event" : next.title,
            nextDate: new Date(next.at).getTime(),
          }
        : {}),
      isRunning: true,
      deepLink: `datebook://open?intent=item&item=${encodeURIComponent(current.id)}`,
    };
  }

  if (future) {
    const startDate = new Date(future.at).getTime();
    const endDate = future.endAt ? new Date(future.endAt).getTime() : undefined;
    return {
      ...base,
      mode: future.type === "event" ? "upcoming" : "day",
      title: hidesPrivateDetails
        ? future.type === "event"
          ? "Upcoming event"
          : "Upcoming item"
        : future.title,
      subtitle: future.type === "event" ? "Up next" : "Your day",
      ...(future.location && !hidesPrivateDetails ? { location: future.location } : {}),
      startDate,
      endDate,
      isRunning: false,
      deepLink: `datebook://open?intent=item&item=${encodeURIComponent(future.id)}`,
    };
  }

  const remaining = openToday[0];
  if (remaining) {
    return {
      ...base,
      mode: "day",
      title: hidesPrivateDetails ? "Today’s item" : remaining.title,
      subtitle: "Your day",
      isRunning: false,
      deepLink: "datebook://today",
    };
  }

  return {
    ...base,
    mode: "allClear",
    title: "Nothing else scheduled today",
    subtitle: "All clear",
    isRunning: false,
    deepLink: "datebook://today",
  };
}
