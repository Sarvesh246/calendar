import { addMinutes, isSameDay } from "date-fns";
import { eventSessionBounds } from "./date-utils";
import type { Item } from "./types";

/** Wall-clock minutes match the grid even on a daylight-saving transition. */
export function weekEventWindow(item: Item, day: Date) {
  const start = new Date(item.at);
  const session = eventSessionBounds(item, day) ?? {
    start,
    end: addMinutes(start, 45),
  };
  const startMin = session.start.getHours() * 60 + session.start.getMinutes();
  const endMin = isSameDay(session.end, day)
    ? session.end.getHours() * 60 + session.end.getMinutes()
    : 1440;
  return { startMin, endMin: Math.max(startMin + 1, endMin) };
}
