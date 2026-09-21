import { describe, expect, it } from "vitest";
import { buildLiveActivitySnapshot, upcomingReminderFires } from "./native-snapshot";
import type { FocusSession } from "./focus-session";
import type { Category, Item } from "./types";

const due = (over: Partial<Item> = {}): Item => ({
  id: "a1",
  categoryId: "c",
  type: "assignment",
  title: "Lab 4",
  at: new Date(2026, 8, 11, 18, 0).toISOString(),
  createdAt: new Date(2026, 8, 1).toISOString(),
  status: "todo",
  reminders: [{ id: "r1", itemId: "a1", offsetMinutes: 60, label: "1 hour before" }],
  ...over,
});

describe("upcomingReminderFires", () => {
  it("schedules future time reminders and skips past ones", () => {
    const now = new Date(2026, 8, 11, 10, 0).getTime();
    const fires = upcomingReminderFires([due()], false, 10, now);
    expect(fires).toHaveLength(1);
    expect(fires[0].kind).toBe("time");
    expect(fires[0].itemId).toBe("a1");
  });

  it("keeps arrive-here reminders even without a fireAt", () => {
    const now = new Date(2026, 8, 11, 10, 0).getTime();
    const fires = upcomingReminderFires(
      [
        due({
          reminders: [
            {
              id: "p1",
              itemId: "a1",
              offsetMinutes: 0,
              label: "When I arrive",
              place: { name: "Library", lat: 30.62, lng: -96.33 },
            },
          ],
        }),
      ],
      false,
      10,
      now
    );
    expect(fires).toHaveLength(1);
    expect(fires[0].kind).toBe("location");
    expect(fires[0].place?.name).toBe("Library");
  });
});

const category: Category = { id: "c", name: "MATH 150", color: "#4466AA" };
const at = (hour: number, minute = 0) => new Date(2026, 8, 21, hour, minute).toISOString();
const event = (over: Partial<Item> = {}): Item => ({
  id: "event-1",
  categoryId: "c",
  type: "event",
  title: "Linear Algebra Workshop",
  at: at(16, 10),
  endAt: at(17),
  location: "Blocker 102",
  createdAt: at(8),
  ...over,
});
const live = (items: Item[], now: Date, focus: FocusSession | null = null, privacy: "show" | "hide" = "show") =>
  buildLiveActivitySnapshot({
    items,
    categories: [category],
    focus,
    enabled: true,
    privacy,
    accentHex: "#4466AA",
    now,
  });

describe("buildLiveActivitySnapshot", () => {
  it("maps a future event to an upcoming state", () => {
    const state = live([event()], new Date(2026, 8, 21, 15, 32));
    expect(state.mode).toBe("upcoming");
    expect(state.title).toBe("Linear Algebra Workshop");
    expect(state.startDate).toBe(new Date(at(16, 10)).getTime());
  });

  it("maps an active event to current and includes the next concise line", () => {
    const state = live(
      [event(), event({ id: "event-2", title: "Study group", at: at(18), endAt: at(19) })],
      new Date(2026, 8, 21, 16, 30)
    );
    expect(state.mode).toBe("current");
    expect(state.nextTitle).toBe("Study group");
    expect(state.location).toBe("Blocker 102");
  });

  it("uses a day overview for non-event work", () => {
    const state = live(
      [event({ type: "task", title: "Review chapter", endAt: undefined })],
      new Date(2026, 8, 21, 15, 0)
    );
    expect(state.mode).toBe("day");
    expect(state.subtitle).toBe("Your day");
  });

  it("uses a useful all-clear state instead of an empty card", () => {
    const state = live([], new Date(2026, 8, 21, 20, 0));
    expect(state.mode).toBe("allClear");
    expect(state.title).toBe("Nothing else scheduled today");
  });

  it("gives focus priority and preserves countdown dates", () => {
    const now = new Date(2026, 8, 21, 16, 30).getTime();
    const focus: FocusSession = {
      clock: "countdown",
      durationMs: 25 * 60_000,
      targetEndsAt: now + 20 * 60_000,
      activeItemId: "task-1",
      segments: [{ itemId: "task-1", startedAt: now - 5 * 60_000, accumulatedMs: 0 }],
    };
    const task = event({ id: "task-1", type: "task", title: "Private essay", at: at(22) });
    const state = live([event(), task], new Date(now), focus);
    expect(state.mode).toBe("focus");
    expect(state.endDate).toBe(focus.targetEndsAt);
    expect(state.isRunning).toBe(true);
  });

  it("redacts titles and locations before native delivery", () => {
    const state = live([event()], new Date(2026, 8, 21, 16, 30), null, "hide");
    expect(state.title).toBe("Current event");
    expect(state.location).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("Linear Algebra Workshop");
    expect(JSON.stringify(state)).not.toContain("Blocker 102");
  });

  it("accepts long titles and missing locations without corrupting state", () => {
    const title = "Advanced Topics in Mathematical Modeling and Computational Methods";
    const state = live([event({ title, location: undefined })], new Date(2026, 8, 21, 15, 0));
    expect(state.title).toBe(title);
    expect(state.location).toBeUndefined();
  });

  it("reports a disabled preference as not eligible", () => {
    const state = buildLiveActivitySnapshot({
      items: [event()],
      categories: [category],
      focus: null,
      enabled: false,
      privacy: "show",
      accentHex: "#4466AA",
      now: new Date(2026, 8, 21, 15, 0),
    });
    expect(state.eligible).toBe(false);
    expect(state.eligibilityReason).toContain("turned off");
  });

  it("rebuilds at day rollover instead of leaking yesterday's schedule", () => {
    const yesterday = event({ at: new Date(2026, 8, 20, 23, 30).toISOString() });
    const state = live([yesterday], new Date(2026, 8, 21, 0, 1));
    expect(state.mode).toBe("allClear");
    expect(state.totalItemCount).toBe(0);
  });

  it("reflects schedule changes deterministically", () => {
    const now = new Date(2026, 8, 21, 15, 0);
    const before = live([event()], now);
    const after = live([event({ id: "replacement", title: "New room", at: at(15, 20) })], now);
    expect(before.title).toBe("Linear Algebra Workshop");
    expect(after.title).toBe("New room");
    expect(after.startDate).toBe(new Date(at(15, 20)).getTime());
  });

  it("generates a URL-safe item deep link", () => {
    const state = live([event({ id: "course/a b" })], new Date(2026, 8, 21, 15, 0));
    expect(state.deepLink).toBe("datebook://open?intent=item&item=course%2Fa%20b");
  });
});
