import { format } from "date-fns";
import { formatTime } from "./date-utils";
import { dateFromDayKey, dayAtMinute } from "./calendar-drag-math";

/** "2:30 PM" for a minute of a given day, honouring the 24-hour setting. */
export function minuteLabel(key: string, minute: number, clock24h: boolean): string {
  return formatTime(dayAtMinute(key, minute).toISOString(), clock24h);
}

/** "Tue, Sep 15 · 2:30 PM" or, with an end, "Tue, Sep 15 · 2:30 PM – 3:30 PM". */
export function slotLabel(key: string, startMin: number, endMin: number | null, clock24h: boolean): string {
  const day = format(dateFromDayKey(key), "EEE, MMM d");
  const start = minuteLabel(key, startMin, clock24h);
  return endMin == null ? `${day} · ${start}` : `${day} · ${start} – ${minuteLabel(key, endMin, clock24h)}`;
}
