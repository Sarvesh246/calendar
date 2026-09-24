import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockFace,
  closeActiveAndSelect,
  COUNTDOWN_MS,
  defaultFocusItem,
  emptySession,
  formatClockFace,
  isFocusSession,
  isRunning,
  isSessionLive,
  itemElapsedMs,
  loadFocusSession,
  pauseClock,
  rankFocusItems,
  saveFocusSession,
  sessionElapsedMs,
  setClockMode,
  startClock,
  switchActive,
  timedItemCount,
  toggleClock,
} from "./focus-session";
import type { Item } from "./types";

const now0 = 1_000_000;

function work(over: Partial<Item> = {}): Item {
  return {
    id: "a",
    categoryId: "c",
    type: "assignment",
    title: "Essay",
    at: new Date("2026-09-16T23:59:00").toISOString(),
    createdAt: new Date("2026-09-01T12:00:00").toISOString(),
    status: "todo",
    ...over,
  };
}

function mockSessionStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  vi.stubGlobal("sessionStorage", storage);
  return storage;
}

describe("focus session clock", () => {
  it("accumulates wall-clock elapsed, not ticks", () => {
    let session = emptySession("a", now0);
    session = startClock(session, now0);
    expect(itemElapsedMs(session, "a", now0 + 5_000)).toBe(5_000);
    expect(itemElapsedMs(session, "a", now0 + 90_000)).toBe(90_000);
  });

  it("pause folds elapsed into accumulatedMs and resume continues", () => {
    let session = startClock(emptySession("a", now0), now0);
    session = pauseClock(session, now0 + 10_000);
    expect(isRunning(session)).toBe(false);
    expect(itemElapsedMs(session, "a", now0 + 60_000)).toBe(10_000);
    const active = session.segments[0];
    expect(active.accumulatedMs).toBe(10_000);
    expect(active.pausedAt).toBe(now0 + 10_000);

    session = startClock(session, now0 + 80_000);
    expect(itemElapsedMs(session, "a", now0 + 85_000)).toBe(15_000);
  });

  it("switch closes the old segment and opens a new one", () => {
    let session = startClock(emptySession("a", now0), now0);
    session = switchActive(session, "b", now0 + 4_000);
    expect(session.activeItemId).toBe("b");
    expect(isRunning(session)).toBe(true);
    expect(itemElapsedMs(session, "a", now0 + 20_000)).toBe(4_000);
    expect(itemElapsedMs(session, "b", now0 + 20_000)).toBe(16_000);
    expect(sessionElapsedMs(session, now0 + 20_000)).toBe(20_000);
    expect(timedItemCount(session, now0 + 20_000)).toBe(2);
  });

  it("countdown hits zero then counts up as overtime", () => {
    let session = setClockMode(emptySession("a", now0), "countdown", COUNTDOWN_MS[25], now0);
    session = startClock(session, now0);
    const face = clockFace(session, now0 + COUNTDOWN_MS[25] + 3_000);
    expect(face.kind).toBe("overtime");
    expect(face.ms).toBe(3_000);
    expect(formatClockFace(face)).toBe("+0:03");
  });

  it("paused countdown does not keep ticking", () => {
    let session = setClockMode(emptySession("a", now0), "countdown", 60_000, now0);
    session = startClock(session, now0);
    session = pauseClock(session, now0 + 10_000);
    expect(clockFace(session, now0 + 50_000)).toEqual({ kind: "remaining", ms: 50_000 });
    session = startClock(session, now0 + 80_000);
    expect(clockFace(session, now0 + 90_000)).toEqual({ kind: "remaining", ms: 40_000 });
  });

  it("complete keeps the room idle on the next item", () => {
    let session = startClock(emptySession("a", now0), now0);
    session = closeActiveAndSelect(session, "b", now0 + 2_000);
    expect(isRunning(session)).toBe(false);
    expect(session.activeItemId).toBe("b");
    expect(itemElapsedMs(session, "a", now0 + 9_000)).toBe(2_000);
  });

  it("toggleClock starts then pauses", () => {
    let session = toggleClock(emptySession("a", now0), now0);
    expect(isRunning(session)).toBe(true);
    session = toggleClock(session, now0 + 1);
    expect(isRunning(session)).toBe(false);
  });

  it("isSessionLive is false until time actually accrues or the clock is running", () => {
    const idle = emptySession("a", now0);
    expect(isSessionLive(idle, now0)).toBe(false);
    expect(isSessionLive(startClock(idle, now0), now0)).toBe(true);
  });
});

describe("persist", () => {
  beforeEach(() => {
    mockSessionStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a session through sessionStorage", () => {
    const session = startClock(emptySession("essay", now0), now0);
    saveFocusSession(session);
    const loaded = loadFocusSession();
    expect(loaded).toEqual(session);
  });

  it("rejects malformed JSON", () => {
    sessionStorage.setItem("datebook-draft:focus-session", "{not json");
    expect(loadFocusSession()).toBeNull();
    sessionStorage.setItem("datebook-draft:focus-session", JSON.stringify({ clock: "nope", segments: [] }));
    expect(loadFocusSession()).toBeNull();
    expect(isFocusSession(null)).toBe(false);
    expect(isFocusSession({ clock: "stopwatch", durationMs: null, targetEndsAt: null, segments: "x" })).toBe(false);
  });
});

describe("default pick and rank", () => {
  const now = new Date("2026-09-16T12:00:00");

  it("prefers an in-progress item over the queue", () => {
    const items = [
      work({ id: "later", at: new Date("2026-09-16T18:00:00").toISOString() }),
      work({ id: "doing", title: "Lab", status: "doing", at: new Date("2026-09-20T18:00:00").toISOString() }),
    ];
    expect(defaultFocusItem(items, now)?.id).toBe("doing");
  });

  it("ranks doing, then suggested, then overdue", () => {
    const items = [
      work({ id: "later", at: new Date("2026-09-20T12:00:00").toISOString() }),
      work({ id: "overdue", at: new Date("2026-09-10T12:00:00").toISOString() }),
      work({ id: "doing", status: "doing", at: new Date("2026-09-22T12:00:00").toISOString() }),
    ];
    expect(rankFocusItems(items, now).map((i) => i.id)).toEqual(["doing", "later", "overdue"]);
  });
});
