"use client";

import { format, isToday } from "date-fns";
import type { Item, Reminder } from "./types";
import { subscribePush } from "./push-client";
import {
  DEFAULT_CLASS_REMINDER_MINUTES,
  classReminderFor,
  isSynthesizedClassReminder,
} from "./class-reminder";

/* ------------------------------------------------------------------ */
/* Local reminder delivery                                             */
/* ------------------------------------------------------------------ */
/* There is no push server, so reminders fire from the page: every     */
/* reminder due within the next 24h is scheduled with setTimeout while */
/* a tab is alive, and any that came due while every tab was closed    */
/* are delivered on the next load (within a grace window, so we don't  */
/* dump a week of stale alerts at once). A minimal service worker      */
/* (public/sw.js) handles the notification click; when it's in control */
/* we route through registration.showNotification so alerts survive a  */
/* backgrounded tab on mobile, where `new Notification()` throws.      */

const FIRED_KEY = "datebook-reminders-fired";
const SCHEDULE_WINDOW_MS = 24 * 60 * 60 * 1000; // only arm timers this far out
const CATCH_UP_GRACE_MS = 12 * 60 * 60 * 1000; // deliver misses newer than this
// A class heads-up is worth almost nothing late — "starts in 30 minutes" an hour
// after the fact is noise — so its catch-up window is minutes, not hours. It's
// also what keeps re-timing the setting quiet: bumping 10 → 30 while class is 20
// minutes out doesn't immediately fire the offset that already passed.
const CLASS_CATCH_UP_MS = 3 * 60 * 1000;
const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let promptedThisSession = false;

/** What a first arm needs from the store, read after the permission prompt
 *  resolves so it reflects whatever the user has set by then. */
export interface ReminderContext {
  items: Item[];
  clock24h: boolean;
  classReminderMinutes: number;
}

/**
 * Call from the click handler that attaches a reminder to a new item: if the
 * user hasn't decided about notifications yet, ask now (a natural moment, and a
 * real user gesture). No-op once decided or once asked this session.
 */
export async function maybePromptForReminders(
  getContext: () => ReminderContext
): Promise<void> {
  if (promptedThisSession || notificationPermission() !== "default") return;
  promptedThisSession = true;
  const result = await requestNotificationPermission();
  if (result === "granted") {
    await ensureReminderWorker();
    const ctx = getContext();
    armReminders(ctx.items, ctx.clock24h, ctx.classReminderMinutes);
    void subscribePush();
  }
}

/** Register the click-handling service worker. Safe to call repeatedly. */
export async function ensureReminderWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return true;
  } catch {
    return false;
  }
}

/* --- fired-key bookkeeping --------------------------------------- */

function reminderKey(itemId: string, reminderId: string, offsetMinutes: number): string {
  return `${itemId}:${reminderId || `o${offsetMinutes}`}`;
}

function readFired(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    let changed = false;
    for (const [k, t] of Object.entries(parsed)) {
      if (typeof t !== "number" || t < cutoff) {
        delete parsed[k];
        changed = true;
      }
    }
    if (changed) localStorage.setItem(FIRED_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}

function markFired(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const fired = readFired();
    fired[key] = Date.now();
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    /* storage full / disabled — worst case the reminder repeats once */
  }
}

/* --- notification rendering ------------------------------------- */

function reminderBody(item: Item, clock24h: boolean): string {
  const at = new Date(item.at);
  const when = format(at, clock24h ? "EEE, MMM d · HH:mm" : "EEE, MMM d · h:mm a");
  if (item.allDay) {
    const day = isToday(at) ? "today" : format(at, "EEE, MMM d");
    return item.type === "event" ? `All day ${day}` : `Due ${day}`;
  }
  return item.type === "event" ? `Starts ${when}` : `Due ${when}`;
}

/**
 * Show one reminder, returning whether it actually landed on screen.
 *
 * This used to reach for `serviceWorker.getRegistration()` and call
 * `showNotification` on whatever it found — including a registration that was
 * still installing. Right after the very first "Enable notifications" tap,
 * `ensureReminderWorker()` and `armReminders()` both fire without waiting on
 * each other, so the worker frequently isn't active yet; some browsers throw
 * on `showNotification` in that state, which the old code swallowed with no
 * fallback. That first reminder — often the most important one, since it's
 * usually a catch-up notification for something already due — just vanished.
 *
 * Now it only trusts a worker that's actually controlling this page, and
 * always falls back to a plain page-context `Notification` (which works
 * immediately, with no activation race) whenever the worker path isn't
 * available or throws.
 */
async function showReminder(item: Item, label: string, clock24h: boolean): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const title = item.type === "event" ? item.title : `Due soon: ${item.title}`;
  const options: NotificationOptions & { tag: string; data?: { itemId: string } } = {
    body: `${label} · ${reminderBody(item, clock24h)}`,
    tag: `datebook-${item.id}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { itemId: item.id },
    actions: [
      { action: "open", title: "Open" },
      { action: "snooze", title: "Snooze 15 min" },
    ],
  } as NotificationOptions & { tag: string };

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return true;
    } catch {
      /* fall through to the page-context path below */
    }
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    // Mobile Safari with no active worker throws here (it has no page-context
    // Notification at all) — nothing more this tab can do.
    return false;
  }
}

/* --- scheduling ------------------------------------------------- */

let timers = new Map<string, ReturnType<typeof setTimeout>>();
// Reminders currently mid-`showReminder()`. `armReminders` re-runs on every
// items change, every 10 minutes, and on every foreground — several of which
// can land while a just-fired reminder's own async attempt is still pending —
// so without this a slow or failing attempt could be started twice.
const inFlight = new Set<string>();

function clearTimers(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers = new Map();
}

/**
 * Deliver a reminder and record it as fired only once it actually displayed.
 * A failed attempt (permission revoked mid-flight, both notification paths
 * throwing) leaves the key unmarked, so the next `armReminders` pass — the
 * 10-minute interval, or the next time the tab is foregrounded — sees a
 * small negative delay and retries it as a catch-up, instead of the reminder
 * being silently lost the moment `showReminder` failed once.
 */
function deliver(key: string, item: Item, label: string, clock24h: boolean): void {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void showReminder(item, label, clock24h)
    .then((shown) => {
      if (shown) markFired(key);
    })
    .finally(() => {
      inFlight.delete(key);
    });
}

/**
 * Every reminder that should fire for `item`: the ones the user attached, plus
 * the class heads-up derived from `classReminderMinutes`. The derived one is
 * never stored on the item, so re-timing it in Settings takes effect on the
 * next pass — no item writes, no sync round-trip.
 */
function effectiveReminders(item: Item, classReminderMinutes: number): Reminder[] {
  const own = item.reminders ?? [];
  const classReminder = classReminderFor(item, classReminderMinutes);
  return classReminder ? [...own, classReminder] : own;
}

/**
 * (Re)compute every pending reminder and arm a timer for the ones due within the
 * next 24h. Idempotent — call it on load, whenever items change, on an interval,
 * and when a tab returns to the foreground.
 */
export function armReminders(
  items: Item[],
  clock24h = false,
  classReminderMinutes = DEFAULT_CLASS_REMINDER_MINUTES
): void {
  if (notificationPermission() !== "granted") {
    clearTimers();
    return;
  }
  clearTimers();
  const now = Date.now();
  const fired = readFired();

  for (const item of items) {
    if (item.status === "done") continue;
    const reminders = effectiveReminders(item, classReminderMinutes);
    if (!reminders.length) continue;
    const at = new Date(item.at).getTime();
    if (Number.isNaN(at)) continue;

    for (const r of reminders) {
      const key = reminderKey(item.id, r.id, r.offsetMinutes);
      if (fired[key]) continue;
      const fireAt = at - r.offsetMinutes * 60_000;
      const delay = fireAt - now;
      const isClass = isSynthesizedClassReminder(r);

      if (delay <= 0) {
        // Came due while the app was closed. Deliver recent misses once; let old
        // ones lapse silently so reopening after a trip isn't an alert storm.
        // A class heads-up also has to still be a heads-up: once the meeting has
        // started, the countdown card and the "In class" card say it better.
        const grace = isClass ? CLASS_CATCH_UP_MS : CATCH_UP_GRACE_MS;
        const stillUseful = isClass ? at > now : at > now - 60 * 60_000;
        if (delay > -grace && stillUseful) {
          deliver(key, item, r.label, clock24h);
        } else {
          markFired(key);
        }
        continue;
      }
      if (delay > SCHEDULE_WINDOW_MS) continue; // a later re-arm will catch it

      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          deliver(key, item, r.label, clock24h);
        }, delay)
      );
    }
  }
}

export function disarmReminders(): void {
  clearTimers();
}
