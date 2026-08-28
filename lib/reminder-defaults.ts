import { nanoid } from "./nanoid";
import type { Reminder, ReminderPreset } from "./types";

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
