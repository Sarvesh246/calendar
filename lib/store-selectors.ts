"use client";

import { useShallow } from "zustand/react/shallow";
import { useDatebookStore } from "./store";
import type { Item } from "./types";

/** All items — prefer narrower selectors when possible. */
export function useItems(): Item[] {
  return useDatebookStore((s) => s.items);
}

/** Non-done items (assignments/tasks/events still active). */
export function useOpenItems(): Item[] {
  return useDatebookStore(useShallow((s) => s.items.filter((i) => i.status !== "done")));
}

/** Items that may need reminder scheduling. */
export function useReminderItems(): Item[] {
  return useDatebookStore(
    useShallow((s) =>
      s.items.filter((i) => i.status !== "done" && (i.reminders?.length ?? 0) > 0)
    )
  );
}

export function useSettings() {
  return useDatebookStore((s) => s.settings);
}

export function useItemById(id: string | undefined): Item | undefined {
  return useDatebookStore((s) => (id ? s.items.find((i) => i.id === id) : undefined));
}
