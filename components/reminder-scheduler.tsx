"use client";

import { useEffect } from "react";
import { useDatebookStore } from "@/lib/store";
import {
  armReminders,
  disarmReminders,
  ensureReminderWorker,
  notificationPermission,
} from "@/lib/reminders";

/**
 * Headless. Keeps the local reminder timers in sync with the item list: re-arms
 * whenever items change, every 10 minutes (to pull in reminders that were beyond
 * the 24h scheduling window), and when a tab returns to the foreground (mobile
 * browsers freeze timers while backgrounded).
 */
export function ReminderScheduler() {
  const items = useDatebookStore((s) => s.items);

  useEffect(() => {
    void ensureReminderWorker();
  }, []);

  useEffect(() => {
    if (notificationPermission() !== "granted") {
      disarmReminders();
      return;
    }
    armReminders(items);

    const interval = setInterval(() => armReminders(useDatebookStore.getState().items), 10 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        armReminders(useDatebookStore.getState().items);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [items]);

  return null;
}
