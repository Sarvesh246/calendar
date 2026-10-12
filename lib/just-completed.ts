"use client";

import { useSyncExternalStore } from "react";
import { useDatebookStore } from "./store";
import { prefersReducedMotion } from "./motion";
import type { Item } from "./types";

/**
 * How long a just-completed item keeps its place: long enough to watch the
 * tick pop, the strike-through draw and the title dim before the card gives
 * its place back. Shared with `useCompletionLinger`.
 */
export const LINGER_MS = 780;

const EMPTY: ReadonlySet<string> = new Set();
let ids: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();
let watching = false;

function publish(next: ReadonlySet<string>) {
  ids = next;
  listeners.forEach((listener) => listener());
}

/**
 * Items whose status turned to done in the last `LINGER_MS`.
 *
 * `useCompletionLinger` keeps a finished card in a list that "hide completed"
 * would empty — but some lists choose their members by status themselves.
 * Overdue is "past due and not done", so ticking an overdue item removed it
 * from that section on the same frame, linger or not: you tapped, and it
 * vanished. Sections like that ask this set instead, and keep the item for the
 * same beat every other list does.
 */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  let previous = new Map(useDatebookStore.getState().items.map((i) => [i.id, i.status]));
  useDatebookStore.subscribe((state, prior) => {
    if (state.items === prior.items) return;
    const finished: string[] = [];
    const next = new Map<string, Item["status"]>();
    for (const item of state.items) {
      next.set(item.id, item.status);
      const before = previous.get(item.id);
      if (item.status === "done" && previous.has(item.id) && before !== "done")
        finished.push(item.id);
    }
    previous = next;
    if (finished.length === 0 || prefersReducedMotion()) return;
    publish(new Set([...ids, ...finished]));
    window.setTimeout(() => {
      const remaining = new Set(ids);
      finished.forEach((id) => remaining.delete(id));
      publish(remaining.size ? remaining : EMPTY);
    }, LINGER_MS);
  });
}

function subscribe(listener: () => void) {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useJustCompleted(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => ids,
    () => EMPTY,
  );
}
