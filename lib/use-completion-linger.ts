"use client";

import { useEffect, useRef, useState } from "react";
import { useDatebookStore } from "./store";
import { prefersReducedMotion } from "./motion";
import type { Item } from "./types";

/**
 * Let a completed item finish being completed before it leaves.
 *
 * `ItemCard` has a lovely little sequence for this: the circle fills, a ripple
 * goes out, and a beat later the title dims and strikes through. None of which
 * you have ever seen with "hide completed" on, because ticking the circle
 * removed the item from the filtered list on the same frame — the card was
 * unmounted before the first step finished. You tapped, and something vanished.
 *
 * So a card that leaves *because it was completed* is held in the list a little
 * longer. Long enough for the tick and the strike-through to read as a
 * consequence of the tap; short enough that the list is never lying about what
 * is in it.
 *
 * Only completion earns this. Deleting, filtering, and editing a date all still
 * take effect immediately, because in those cases the thing you want to see is
 * the list without the item.
 */

/** Covers the complete-circle ripple plus the strike-through that follows it. */
const LINGER_MS = 560;

export function useCompletionLinger(items: Item[]): Item[] {
  const [lingering, setLingering] = useState<Item[]>([]);
  const previous = useRef<Item[]>(items);

  useEffect(() => {
    const present = new Set(items.map((i) => i.id));
    const dropped = previous.current.filter((i) => !present.has(i.id));
    previous.current = items;
    if (dropped.length === 0) return;

    if (prefersReducedMotion()) return;

    // Why it left matters. An item still in the store and now marked done was
    // hidden by "hide completed"; one that is gone from the store was deleted,
    // and holding a deleted row on screen would be a lie.
    const all = useDatebookStore.getState().items;
    const justCompleted = dropped.filter((row) => {
      const live = all.find((i) => i.id === row.id);
      return live?.status === "done" && row.status !== "done";
    });
    if (justCompleted.length === 0) return;

    setLingering((current) => [
      ...current.filter((i) => !justCompleted.some((j) => j.id === i.id)),
      // Carry the *live* row so the card renders as done and plays the settle.
      ...justCompleted.map((row) => all.find((i) => i.id === row.id) ?? row),
    ]);

    const ids = justCompleted.map((i) => i.id);
    const timer = window.setTimeout(() => {
      setLingering((current) => current.filter((i) => !ids.includes(i.id)));
    }, LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [items]);

  // Drop anything that has come back on its own (undo, a re-filter), so an
  // undone item is never rendered twice.
  useEffect(() => {
    if (lingering.length === 0) return;
    const present = new Set(items.map((i) => i.id));
    if (!lingering.some((i) => present.has(i.id))) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLingering((current) => current.filter((i) => !present.has(i.id)));
  }, [items, lingering]);

  if (lingering.length === 0) return items;

  // Re-inserted in time order rather than appended, so a card settles where it
  // was standing instead of jumping to the end of the list to do it.
  return [...items, ...lingering].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
}
