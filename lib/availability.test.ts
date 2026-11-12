import { expect, it } from "vitest";
import { findFreeTime } from "./availability";

it("finds free slots around a conflict", () => {
  const events = [
    {
      id: "1",
      title: "Meeting",
      type: "event",
      at: "2026-11-12T10:00:00Z",
      endAt: "2026-11-12T11:00:00Z",
    },
  ];
  expect(findFreeTime(events, "2026-11-12T09:00:00Z", "2026-11-12T12:00:00Z", 60, "UTC")).toEqual([
    { start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T10:00:00.000Z" },
    { start: "2026-11-12T11:00:00.000Z", end: "2026-11-12T12:00:00.000Z" },
  ]);
});
