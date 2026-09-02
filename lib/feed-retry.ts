"use client";

/**
 * Per-device retry schedule for calendar feeds.
 *
 * A failed fetch used to leave `lastSyncedAt` untouched, which is also the value
 * the staleness check reads — so a feed that failed once was considered due
 * again immediately and retried on every tab focus. Against a rate-limited
 * source that is self-sustaining: the retries are what keep it rate-limited.
 *
 * Deliberately device-local (and not part of the synced `ImportSource`): the
 * quota being backed off from is this device's, and two devices should not
 * inherit each other's penalty box.
 */

const KEY = "datebook-feed-retry";
const BASE_DELAY_MS = 5 * 60_000;
const MAX_DELAY_MS = 3 * 60 * 60_000;
/** A rate-limited source needs longer than a merely broken one. */
const RATE_LIMIT_FLOOR_MS = 15 * 60_000;
/** Failures to absorb silently before the feed is worth mentioning. */
const QUIET_FAILURES = 2;
/** …unless the data has gone stale enough to matter regardless. */
const STALE_ENOUGH_MS = 6 * 60 * 60_000;

interface Entry {
  fails: number;
  nextAt: number;
}

type Store = Record<string, Entry>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — backoff degrades to in-memory for this session */
  }
}

/** True when this device may try `url` again now. */
export function mayAttempt(url: string, now = Date.now()): boolean {
  const entry = read()[url];
  return !entry || now >= entry.nextAt;
}

export function noteFeedSuccess(url: string) {
  const store = read();
  if (!store[url]) return;
  delete store[url];
  write(store);
}

export interface FailureVerdict {
  /** Whether the user should be told. Transient trouble stays quiet. */
  surface: boolean;
  /** When this device will try again. */
  nextAt: number;
}

export function noteFeedFailure(
  url: string,
  opts: { rateLimited?: boolean; lastSyncedAt?: string; now?: number } = {}
): FailureVerdict {
  const now = opts.now ?? Date.now();
  const store = read();
  const fails = (store[url]?.fails ?? 0) + 1;
  const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (fails - 1));
  const nextAt = now + Math.max(backoff, opts.rateLimited ? RATE_LIMIT_FLOOR_MS : 0);
  store[url] = { fails, nextAt };
  write(store);

  const lastOk = opts.lastSyncedAt ? Date.parse(opts.lastSyncedAt) : NaN;
  const stale = Number.isNaN(lastOk) || now - lastOk > STALE_ENOUGH_MS;
  // Being rate-limited is this device's problem to wait out, not something to
  // put a warning banner in front of the user for — the calendar on screen is
  // still correct, just not freshly re-checked.
  const surface = stale || (!opts.rateLimited && fails > QUIET_FAILURES);
  return { surface, nextAt };
}

/** Forget the schedule for a feed — used when the user asks for a retry. */
export function clearFeedBackoff(url: string) {
  noteFeedSuccess(url);
}
