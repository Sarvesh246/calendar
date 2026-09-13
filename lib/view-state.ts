/**
 * Where you were, remembered.
 *
 * Switching tabs already kept its scroll position in memory (see
 * `TabPageHost`), but anything that left the tab host — opening Settings, the
 * schedule, a reload after the OS reclaimed the tab — dropped the lot: the day
 * you had selected on the calendar, the month you had paged to, how far down
 * Agenda you were. On a phone that reads as the app forgetting what you were
 * doing every time you look something up.
 *
 * This is the one place that memory lives. `sessionStorage`, not
 * `localStorage`, on purpose: coming back to the app tomorrow should start on
 * today, not on the Thursday in March you were poking at last night. Within a
 * session it survives navigation, reloads, and the tab being restored.
 *
 * Every read is defensive — quota errors, private mode, a half-written value
 * from an older build all degrade to "no memory", never to a crash.
 */

const KEY = "datebook-view-state";

export interface ViewState {
  /** Document scroll offset per route. */
  scroll: Record<string, number>;
  /** `yyyy-MM-dd` of the month/week the calendar was paged to. */
  calendarAnchor?: string;
  /** `yyyy-MM-dd` of the day whose details were open. */
  calendarSelected?: string;
  /** `0`–`6` weekday the phone schedule was showing. */
  scheduleDay?: number;
  /** Class ids the filter was narrowed to. */
  categoryFilter?: string[] | null;
}

const EMPTY: ViewState = { scroll: {} };

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Parse whatever is in storage into a shape the app can trust. */
export function parseViewState(raw: string | null): ViewState {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const value = parsed as Record<string, unknown>;

  const scroll: Record<string, number> = {};
  if (value.scroll && typeof value.scroll === "object") {
    for (const [route, y] of Object.entries(value.scroll as Record<string, unknown>)) {
      if (typeof y === "number" && Number.isFinite(y) && y >= 0) scroll[route] = y;
    }
  }

  const next: ViewState = { scroll };
  if (isDayKey(value.calendarAnchor)) next.calendarAnchor = value.calendarAnchor;
  if (isDayKey(value.calendarSelected)) next.calendarSelected = value.calendarSelected;
  if (
    typeof value.scheduleDay === "number" &&
    Number.isInteger(value.scheduleDay) &&
    value.scheduleDay >= 0 &&
    value.scheduleDay <= 6
  ) {
    next.scheduleDay = value.scheduleDay;
  }
  if (Array.isArray(value.categoryFilter)) {
    const ids = value.categoryFilter.filter((id): id is string => typeof id === "string");
    next.categoryFilter = ids.length > 0 ? ids : null;
  } else if (value.categoryFilter === null) {
    next.categoryFilter = null;
  }
  return next;
}

/**
 * The in-memory copy is the source of truth for reads. Storage is a mirror
 * written on a trailing timer, so a scroll gesture never serialises JSON on
 * every frame — the one thing that could make remembering your place cost more
 * than losing it.
 */
let cache: ViewState | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readViewState(): ViewState {
  if (cache) return cache;
  const store = storage();
  cache = store ? parseViewState(store.getItem(KEY)) : { scroll: {} };
  return cache;
}

function persistSoon() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushViewState();
  }, 250);
}

/** Write the mirror now — used on `pagehide`, where a timer would never run. */
export function flushViewState() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const store = storage();
  if (!store || !cache) return;
  try {
    store.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Quota or private mode — the in-memory copy still works this session. */
  }
}

export function patchViewState(patch: Partial<ViewState>) {
  cache = { ...readViewState(), ...patch };
  persistSoon();
}

export function rememberScroll(route: string, y: number) {
  const current = readViewState();
  if (current.scroll[route] === y) return;
  cache = { ...current, scroll: { ...current.scroll, [route]: y } };
  persistSoon();
}

export function recallScroll(route: string): number {
  return readViewState().scroll[route] ?? 0;
}

/** Test seam — drops the in-memory copy so the next read re-parses storage. */
export function resetViewStateCache() {
  cache = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}
