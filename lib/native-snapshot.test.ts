import { describe, expect, it } from "vitest";
import { upcomingReminderFires } from "./native-snapshot";
import type { Item } from "./types";

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
