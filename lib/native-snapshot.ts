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

  const liveNow = happeningNow(items, now, categories)[0];
  const soon = items.find((i) => isClassStartingSoon(i, now, windowMs));
  const liveSrc =
    liveNow && isClassMeeting(liveNow, catName(categories, liveNow.categoryId)) ? liveNow : soon;
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
      };
    }
  }

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
    spotlight,
    calendarEvents,
    appleCalendarSync: Boolean(opts.appleCalendarSync),
    feeds: opts.importSources
      .filter((s) => s.url.startsWith("http"))
      .map((s) => ({ id: s.id, url: s.url, name: s.name })),
  };
}
