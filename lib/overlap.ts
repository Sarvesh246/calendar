import type { Item } from "./types";
import { weekEventWindow } from "./week-layout";

/**
 * Which of a day's events actually collide.
 *
 * On a laptop the week grid answers this by drawing colliding events
 * side-by-side. On a 390px phone that same answer is two 80px slivers of text
 * you have to decipher, and the day *list* — which is what phones actually show
 * — never answered it at all: two classes at the same hour appear as two
 * ordinary rows, one after the other, reading as "first this, then that".
 *
 * So the phone gets a sentence instead of a diagram. This finds the runs of
 * genuinely concurrent events; the UI turns each into a compact
 * "2 events overlap" line that opens the readable list.
 *
 * All-day items are excluded on purpose: an all-day item overlaps everything,
 * which would flag every day with a holiday on it and mean nothing.
 */

export interface OverlapGroup {
  /** Stable across renders for the same run of events. */
  key: string;
  items: Item[];
  /** Minutes past midnight the whole run spans. */
  startMin: number;
  endMin: number;
  /** Minutes where at least two of them are running at once. */
  overlapMin: number;
}

interface Placed {
  item: Item;
  startMin: number;
  endMin: number;
}

function timedEvents(items: Item[], day: Date): Placed[] {
  const placed: Placed[] = [];
  for (const item of items) {
    if (item.type !== "event" || item.allDay) continue;
    if (Number.isNaN(new Date(item.at).getTime())) continue;
    const { startMin, endMin } = weekEventWindow(item, day);
    placed.push({ item, startMin, endMin });
  }
  return placed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/**
 * Runs of events that chain together by overlap. A three-way chain where A/B
 * overlap and B/C overlap is reported as one group of three — that is what the
 * day actually looks like, and splitting it into two pairs would double-count
 * B in the UI.
 */
export function findOverlapGroups(items: Item[], day: Date): OverlapGroup[] {
  const placed = timedEvents(items, day);
  const groups: OverlapGroup[] = [];

  let run: Placed[] = [];
  let runEnd = -Infinity;

  const flush = () => {
    if (run.length >= 2) groups.push(toGroup(run));
    run = [];
    runEnd = -Infinity;
  };

  for (const entry of placed) {
    // Touching is not overlapping: a class that ends at 10:00 and one that
    // starts at 10:00 are back-to-back, which is a different (fine) thing.
    if (run.length > 0 && entry.startMin >= runEnd) flush();
    run.push(entry);
    runEnd = Math.max(runEnd, entry.endMin);
  }
  flush();

  return groups;
}

function toGroup(run: Placed[]): OverlapGroup {
  const startMin = Math.min(...run.map((p) => p.startMin));
  const endMin = Math.max(...run.map((p) => p.endMin));

  // How much of the run has two or more events live at once — a sweep over the
  // start/end boundaries rather than a minute-by-minute loop.
  const edges = [
    ...run.map((p) => ({ at: p.startMin, delta: 1 })),
    ...run.map((p) => ({ at: p.endMin, delta: -1 })),
  ].sort((a, b) => a.at - b.at || a.delta - b.delta);

  let live = 0;
  let since = 0;
  let overlapMin = 0;
  for (const edge of edges) {
    if (live >= 2) overlapMin += edge.at - since;
    live += edge.delta;
    since = edge.at;
  }

  return {
    key: run.map((p) => p.item.id).join("|"),
    items: run.map((p) => p.item),
    startMin,
    endMin,
    overlapMin: Math.max(0, overlapMin),
  };
}

/** Ids that belong to some overlap group, so a list can mark those rows. */
export function overlappingItemIds(groups: OverlapGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) for (const item of group.items) ids.add(item.id);
  return ids;
}

export function overlapLabel(group: OverlapGroup): string {
  return `${group.items.length} events overlap`;
}
