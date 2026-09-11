import { nanoid } from "./nanoid";
import type { Reminder, ReminderPreset } from "./types";

/** "2 hours before", "1 day before" — the one voice every reminder label uses,
 *  whether it came from a preset, Settings, or a card's custom field. */
export function formatOffsetLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "before";
  const WEEK = 7 * 24 * 60;
  const DAY = 24 * 60;
  if (minutes % WEEK === 0) {
    const n = minutes / WEEK;
    return `${n} week${n === 1 ? "" : "s"} before`;
  }
  if (minutes % DAY === 0) {
    const n = minutes / DAY;
    return `${n} day${n === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) {
    const n = minutes / 60;
    return `${n} hour${n === 1 ? "" : "s"} before`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

export function remindersFromPresetIds(
  ids: string[],
  presets: ReminderPreset[]
): Reminder[] {
  const wanted = new Set(ids);
  return presets
    .filter((p) => wanted.has(p.id))
    .map((p) => ({
      id: nanoid(),
      itemId: "",
      offsetMinutes: p.offsetMinutes,
      label: p.label,
    }));
}
