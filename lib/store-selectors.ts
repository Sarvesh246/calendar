"use client";

import { useShallow } from "zustand/react/shallow";
import { useDatebookStore } from "./store";
import { isClassScheduleItem } from "./class-schedule";
import type { ReminderContext } from "./reminders";
import type { Item } from "./types";

/** All items — prefer narrower selectors when possible. */
export function useItems(): Item[] {
  return useDatebookStore((s) => s.items);
}

/** Non-done items (assignments/tasks/events still active). */
export function useOpenItems(): Item[] {
  return useDatebookStore(useShallow((s) => s.items.filter((i) => i.status !== "done")));
}

/** Items that may need reminder scheduling — anything carrying its own
 *  reminders, plus class meetings, which get their heads-up synthesized from
 *  `settings.classReminderMinutes` instead of storing one per meeting. */
export function useReminderItems(): Item[] {
  return useDatebookStore(
    useShallow((s) =>
      s.items.filter(
        (i) =>
          i.status !== "done" &&
          ((i.reminders?.length ?? 0) > 0 ||
            (s.settings.classReminderMinutes > 0 && isClassScheduleItem(i)))
      )
    )
  );
}

/** Imperative snapshot of what `armReminders` needs, for callers outside the
 *  scheduler (e.g. the first arm right after a permission prompt). */
export function reminderContext(): ReminderContext {
  const s = useDatebookStore.getState();
  return {
    items: s.items,
    clock24h: s.settings.clock24h,
    classReminderMinutes: s.settings.classReminderMinutes,
  };
}

export function useSettings() {
  return useDatebookStore((s) => s.settings);
}

export function useItemById(id: string | undefined): Item | undefined {
  return useDatebookStore((s) => (id ? s.items.find((i) => i.id === id) : undefined));
}
