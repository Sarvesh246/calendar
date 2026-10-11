"use client";

import { useSyncExternalStore } from "react";
import { useDatebookStore } from "./store";
import { prefersReducedMotion } from "./motion";

/** Long enough to find the card, short enough to be gone before you read it. */
const ARRIVAL_MS = 1400;
/** More new rows than this at once is an import or a sync, not something you just typed. */
const MAX_AT_ONCE = 6;

let ids: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let watching = false;

function publish(next: ReadonlySet<string>) {
  ids = next;
  listeners.forEach((listener) => listener());
}

/**
 * Items you created a moment ago, so their card can say "here I am".
 *
 * Adding from the composer used to drop the new row into a list with nothing
 * to mark it — you had to scan for what changed. Only rows that are new to the
 * store, created just now and not imported count; a feed refresh or a cloud
 * sync bringing in dozens of rows never lights anything up.
 */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  let known = new Set(useDatebookStore.getState().items.map((i) => i.id));
  useDatebookStore.subscribe((state, prior) => {
    if (state.items === prior.items) return;
    const fresh: string[] = [];
    const now = Date.now();
    for (const item of state.items) {
      if (known.has(item.id)) continue;
      const created = Date.parse(item.createdAt);
      if (!item.sourceId && Number.isFinite(created) && now - created < 5_000) fresh.push(item.id);
    }
    known = new Set(state.items.map((i) => i.id));
    if (fresh.length === 0 || fresh.length > MAX_AT_ONCE || prefersReducedMotion()) return;
    publish(new Set([...ids, ...fresh]));
    window.setTimeout(() => {
      const remaining = new Set(ids);
      fresh.forEach((id) => remaining.delete(id));
      publish(remaining);
    }, ARRIVAL_MS);
  });
}

function subscribe(listener: () => void) {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True for a moment after `id` was created on this device. */
export function useJustAdded(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ids.has(id),
    () => false
  );
}
