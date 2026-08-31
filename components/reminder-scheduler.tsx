"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";
import {
  armReminders,
  disarmReminders,
  ensureReminderWorker,
  notificationPermission,
} from "@/lib/reminders";
import { subscribePush } from "@/lib/push-client";

/**
 * Headless. Keeps the local reminder timers in sync with the item list: re-arms
 * whenever items change, every 10 minutes (to pull in reminders that were beyond
 * the 24h scheduling window), and when a tab returns to the foreground (mobile
 * browsers freeze timers while backgrounded).
 */
export function ReminderScheduler() {
  const items = useDatebookStore((s) => s.items);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);

  useEffect(() => {
    void (async () => {
      await ensureReminderWorker();
      if (notificationPermission() === "granted") await subscribePush();
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const snoozeId = params.get("snooze");
    if (!snoozeId) return;
    useDatebookStore.getState().snoozeItem(snoozeId, 15);
    params.delete("snooze");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }, []);

  useEffect(() => {
    if (notificationPermission() !== "granted") {
      disarmReminders();
      return;
    }
    armReminders(items, clock24h);

    const interval = setInterval(() => {
      const s = useDatebookStore.getState();
      armReminders(s.items, s.settings.clock24h);
    }, 10 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const s = useDatebookStore.getState();
        armReminders(s.items, s.settings.clock24h);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [items, clock24h]);

  return null;
}
