import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "./types";

/* `lib/reminders` reads browser globals at call time, so the suite stands up a
 * minimal Notification + localStorage before importing it. Each test drives the
 * fake clock forward instead of waiting on real timers. */

const shown: { title: string; body: string }[] = [];

class FakeNotification {
  static permission: NotificationPermission = "granted";
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body ?? "" });
  }
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const lecture = (over: Partial<Item> = {}): Item => ({
  id: "class-1",
  categoryId: "pols",
  type: "event",
  title: "POLS 207",
  at: new Date(2026, 8, 11, 10, 20).toISOString(),
  endAt: new Date(2026, 8, 11, 11, 10).toISOString(),
  createdAt: new Date(2026, 8, 11).toISOString(),
  repeat: { freq: "weekly", byDay: [1, 3, 5] },
  repeatId: "s1",
  ...over,
});

let armReminders: typeof import("./reminders").armReminders;
let disarmReminders: typeof import("./reminders").disarmReminders;

beforeEach(async () => {
  shown.length = 0;
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("window", { Notification: FakeNotification });
  vi.stubGlobal("navigator", {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 11, 9, 0));
  vi.resetModules();
  ({ armReminders, disarmReminders } = await import("./reminders"));
});

afterEach(() => {
  disarmReminders();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Run the arm pass, then let the fake clock reach `when`. */
async function runTo(items: Item[], classMinutes: number, when: Date) {
  armReminders(items, false, classMinutes);
  await vi.advanceTimersByTimeAsync(when.getTime() - Date.now());
  await vi.runAllTicks();
}

describe("armReminders class heads-up", () => {
  it("alerts at the offset the settings ask for", async () => {
    await runTo([lecture()], 30, new Date(2026, 8, 11, 9, 51));
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("POLS 207");
    expect(shown[0].body).toContain("30 minutes before");
  });

  it("has not alerted yet before that offset", async () => {
    await runTo([lecture()], 10, new Date(2026, 8, 11, 10, 9));
    expect(shown).toHaveLength(0);
  });

  it("stays silent when class alerts are off", async () => {
    await runTo([lecture()], 0, new Date(2026, 8, 11, 10, 21));
    expect(shown).toHaveLength(0);
  });

  it("only fires once across repeated arm passes", async () => {
    armReminders([lecture()], false, 30);
    await vi.advanceTimersByTimeAsync(51 * 60_000);
    await vi.runAllTicks();
    armReminders([lecture()], false, 30);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTicks();
    expect(shown).toHaveLength(1);
  });

  it("does not alert for a class that already started", async () => {
    vi.setSystemTime(new Date(2026, 8, 11, 10, 30));
    armReminders([lecture()], false, 30);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runAllTicks();
    expect(shown).toHaveLength(0);
  });

  it("leaves non-class items to their own reminders", async () => {
    const essay = lecture({
      id: "essay",
      type: "assignment",
      title: "Essay",
      repeat: undefined,
      repeatId: undefined,
      status: "todo",
    });
    await runTo([essay], 30, new Date(2026, 8, 11, 10, 21));
    expect(shown).toHaveLength(0);
  });

  it("still fires a reminder the user attached to the class", async () => {
    const item = lecture({
      reminders: [{ id: "r1", itemId: "class-1", offsetMinutes: 60, label: "Leave now" }],
    });
    await runTo([item], 30, new Date(2026, 8, 11, 9, 51));
    expect(shown.map((n) => n.body)).toEqual([
      expect.stringContaining("Leave now"),
      expect.stringContaining("30 minutes before"),
    ]);
  });
});
