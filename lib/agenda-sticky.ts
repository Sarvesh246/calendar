import { format, startOfDay } from "date-fns";

export type AgendaStickyKind = "overdue" | "day" | "later";

export type AgendaStickySection = {
  id: string;
  kind: AgendaStickyKind;
  tone: "warn" | "faint";
  count: number;
  date?: Date;
};

export type AgendaStickyFace = {
  /** Day-of-month, or the overdue count. Absent for "Later". */
  numeral: string | null;
  kicker: string;
  subtitle: string;
};

const DAY_MS = 86_400_000;

function relativeName(date: Date, now: Date): "Today" | "Tomorrow" | "Yesterday" | null {
  const a = startOfDay(date).getTime();
  const b = startOfDay(now).getTime();
  if (a === b) return "Today";
  if (a === b + DAY_MS) return "Tomorrow";
  if (a === b - DAY_MS) return "Yesterday";
  return null;
}

/**
 * The running folio for the agenda's pinned date.
 *
 * In-list headings stay as they are (a screen reader already meets each day
 * there). This is the *visual* restatement: a large calendar numeral with a
 * weekday and month, so the sticky can look like a page from a datebook
 * rather than a toolbar label.
 *
 * Relative names (Tomorrow, …) are taken from `now` — the same clock the
 * agenda page already ticks — so a test, or a session that crosses midnight,
 * never disagrees with the list underneath.
 */
export function agendaStickyFace(section: AgendaStickySection, now = new Date()): AgendaStickyFace {
  if (section.kind === "overdue") {
    return {
      numeral: String(section.count),
      kicker: "Overdue",
      subtitle: section.count === 1 ? "item" : "items",
    };
  }
  if (section.kind === "later") {
    return {
      numeral: null,
      kicker: "Later",
      subtitle: section.count === 1 ? "One more" : `${section.count} more`,
    };
  }
  const date = section.date;
  if (!date || Number.isNaN(date.getTime())) {
    return { numeral: null, kicker: "Agenda", subtitle: "" };
  }
  const relative = relativeName(date, now);
  const crossesYear = date.getFullYear() !== now.getFullYear();
  return {
    numeral: format(date, "d"),
    kicker: relative ?? format(date, "EEEE"),
    subtitle: crossesYear ? format(date, "MMMM yyyy") : format(date, "MMMM"),
  };
}
