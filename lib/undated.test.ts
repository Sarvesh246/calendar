import { expect, it } from "vitest";
import { isDueOnDay, isOverdueAt, groupItemsByDay, nextOpenAssignment } from "./date-utils";
import { summarizeItemWhen } from "./item-summary";
import { buildAssistantDigest } from "./ai-assistant";
import { UNDATED_AT } from "./undated";
import type { Item } from "./types";

it("does not place an undated task on the calendar or label it due", () => {
  const task: Item = {
    id: "u",
    title: "Read",
    type: "task",
    categoryId: "",
    at: UNDATED_AT,
    createdAt: "2026-11-01T00:00:00Z",
  };
  const now = new Date("2026-11-12T12:00:00Z");
  expect(isDueOnDay(task, now)).toBe(false);
  expect(isOverdueAt(task, now)).toBe(false);
  expect(groupItemsByDay([task]).size).toBe(0);
  expect(nextOpenAssignment([task], now)).toBeUndefined();
  expect(summarizeItemWhen(task, now, false).date).toBe("No due date");
  const digest = buildAssistantDigest([task], [], now.toISOString(), "Pacific/Kiritimati");
  expect(digest.overdue).toEqual([]);
  expect(digest.dueByNextSunday).toEqual([]);
});
