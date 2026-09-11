import { addDays, startOfDay, startOfWeek } from "date-fns";
import type { Item } from "./types";

/**
 * Your week, as a repeating shape rather than a list of dates.
 *
 * Classes reach the store two different ways: hand-entered class times are one
 * weekly series expanded into an item per week, while an imported Canvas or
 * Google feed just drops a pile of separate dated events. Both look identical
 * once you ask the only question that matters here — "does this land on the
 * same weekday, at the same time, week after week?" — so one scan covers both
 * and the page never depends on how the schedule got in.
 */

const SCAN_WEEKS_BACK = 3;
const SCAN_WEEKS_FORWARD = 6;
/** A timed event with no end still occupies the slot it starts in. */
const DEFAULT_BLOCK_MINUTES = 50;
const MINUTES_IN_DAY = 24 * 60;

export interface ScheduleBlock {
  /** Stable across renders: title + weekday + time, which is the identity. */
  key: string;
  title: string;
  categoryId?: string;
  location?: string;
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  startMin: number;
  endMin: number;
  /** Distinct weeks this landed in — "twice a week" is already two blocks. */
  weeks: number;
  /** Came from a weekly repeat rule rather than being inferred from repetition. */
  recurring: boolean;
}

export interface WeeklySchedule {
  blocks: ScheduleBlock[];
  /** Weekdays with at least one block, in `weekStartsOn` order. */
  days: number[];
  meetingsPerWeek: number;
  minutesPerWeek: number;
  earliestMin: number;
  latestMin: number;
  categoryIds: string[];
}

interface Draft {
  title: string;
  categoryId?: string;
  location?: string;
  day: number;
  startMin: number;
  endMin: number;
  recurring: boolean;
  weekKeys: Set<string>;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Monday-anchored, so "which week was this" never depends on a user setting. */
function weekKey(date: Date): string {
  return startOfWeek(date, { weekStartsOn: 1 }).toDateString();
}

export function buildWeeklySchedule(
  items: Item[],
  now: Date = new Date(),
  weekStartsOn: 0 | 1 = 0
): WeeklySchedule {
  const from = +startOfDay(addDays(now, -7 * SCAN_WEEKS_BACK));
  const to = +startOfDay(addDays(now, 7 * SCAN_WEEKS_FORWARD));
  const drafts = new Map<string, Draft>();

  for (const item of items) {
    if (item.type !== "event" || item.allDay) continue;
    const start = new Date(item.at);
    const startedAt = +start;
    if (!Number.isFinite(startedAt) || startedAt < from || startedAt > to) continue;

    const title = item.title.trim();
    if (!title) continue;

    const startMin = minutesOfDay(start);
    const end = item.endAt ? new Date(item.endAt) : null;
    const rawEndMin = end && Number.isFinite(+end) ? minutesOfDay(end) : null;
    // A session running past midnight would read as a negative height; clamp it
    // to the end of its own day rather than dropping the class entirely.
    const endMin =
      rawEndMin !== null && rawEndMin > startMin
        ? rawEndMin
        : Math.min(MINUTES_IN_DAY, startMin + DEFAULT_BLOCK_MINUTES);

    const day = start.getDay();
    const key = `${title.toLowerCase()}|${day}|${startMin}|${endMin}`;
    const existing = drafts.get(key);
    if (existing) {
      existing.weekKeys.add(weekKey(start));
      existing.recurring ||= item.repeat?.freq === "weekly";
      existing.location ??= item.location?.trim() || undefined;
      continue;
    }
    drafts.set(key, {
      title,
      categoryId: item.categoryId || undefined,
      location: item.location?.trim() || undefined,
      day,
      startMin,
      endMin,
      recurring: item.repeat?.freq === "weekly",
      weekKeys: new Set([weekKey(start)]),
    });
  }

  const blocks: ScheduleBlock[] = [];
  for (const [key, draft] of drafts) {
    const weeks = draft.weekKeys.size;
    // Two sightings is the whole test for an imported feed. A declared weekly
    // series counts on its own — a course ending next week is still a class.
    if (weeks < 2 && !draft.recurring) continue;
    blocks.push({
      key,
      title: draft.title,
      categoryId: draft.categoryId,
      location: draft.location,
      day: draft.day,
      startMin: draft.startMin,
      endMin: draft.endMin,
      weeks,
      recurring: draft.recurring,
    });
  }

  const order = weekdayOrder(weekStartsOn);
  blocks.sort(
    (a, b) =>
      order.indexOf(a.day) - order.indexOf(b.day) ||
      a.startMin - b.startMin ||
      a.endMin - b.endMin ||
      a.title.localeCompare(b.title)
  );

  const present = new Set(blocks.map((b) => b.day));
  const categoryIds = [...new Set(blocks.map((b) => b.categoryId).filter(Boolean))] as string[];

  return {
    blocks,
    days: order.filter((d) => present.has(d)),
    meetingsPerWeek: blocks.length,
    minutesPerWeek: blocks.reduce((sum, b) => sum + (b.endMin - b.startMin), 0),
    earliestMin: blocks.length ? Math.min(...blocks.map((b) => b.startMin)) : 0,
    latestMin: blocks.length ? Math.max(...blocks.map((b) => b.endMin)) : 0,
    categoryIds,
  };
}

/** Weekdays 0–6 rotated so the user's chosen first day leads. */
export function weekdayOrder(weekStartsOn: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
}

/**
 * Side-by-side placement for blocks that overlap on the same day. Each block
 * gets a lane and the number of lanes its own cluster needs, so a lone class
 * still spans the full column width instead of being sized by the busiest day.
 */
export interface PlacedBlock extends ScheduleBlock {
  lane: number;
  lanes: number;
}

export function placeDayBlocks(blocks: ScheduleBlock[]): PlacedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: PlacedBlock[] = [];
  let cluster: PlacedBlock[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    const lanes = cluster.reduce((max, b) => Math.max(max, b.lane + 1), 0);
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
  };

  for (const block of sorted) {
    if (cluster.length > 0 && block.startMin >= clusterEnd) closeCluster();
    const taken = new Set(
      cluster.filter((b) => b.endMin > block.startMin).map((b) => b.lane)
    );
    let lane = 0;
    while (taken.has(lane)) lane++;
    const next: PlacedBlock = { ...block, lane, lanes: lane + 1 };
    cluster.push(next);
    placed.push(next);
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  closeCluster();
  return placed;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
