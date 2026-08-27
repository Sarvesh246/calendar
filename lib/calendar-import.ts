import { nanoid } from "./nanoid";
import { parseIcs, type IcsEvent } from "./ics";
import type { Category, Item, ItemType } from "./types";

export interface FetchedCalendar {
  calendarName: string | null;
  events: IcsEvent[];
}

/** A prepared item that isn't in the store yet (no id / createdAt). */
export type ImportedDraft = Omit<Item, "id" | "createdAt"> & { sourceUid: string };

export interface ImportPlan {
  newCategories: Category[];
  drafts: ImportedDraft[];
}

const PALETTE = [
  "#7C6CFF",
  "#E8A23D",
  "#4C9BE8",
  "#3DBE8B",
  "#E86D9A",
  "#B57BE0",
  "#48B0A8",
  "#E0603E",
];

/** Strip `webcal://`, trim — the canonical form we store and re-sync against. */
export function normalizeFeedUrl(input: string): string {
  return input.trim().replace(/^webcal:\/\//i, "https://");
}

export function feedLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function fetchCalendarFeed(url: string): Promise<FetchedCalendar> {
  const res = await fetch("/api/import-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  let data: { ok?: boolean; error?: string; text?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error("The import service returned an unexpected response.");
  }
  if (!res.ok || !data.ok || typeof data.text !== "string") {
    throw new Error(data.error ?? "Import failed.");
  }
  const { name, events } = parseIcs(data.text);
  if (events.length === 0) {
    throw new Error("No events found in that feed.");
  }
  return { calendarName: name, events };
}

/** Canvas puts the course in a trailing "[…]": "Essay 1 draft [ENGL 101]". */
function splitCourse(summary: string): { title: string; course: string | null } {
  const m = /^(.*\S)\s*\[([^\]]+)\]\s*$/.exec(summary);
  if (m) return { title: m[1].trim(), course: m[2].trim() };
  return { title: summary.trim(), course: null };
}

function detectType(ev: IcsEvent): ItemType {
  const hay = `${ev.uid} ${ev.url ?? ""}`.toLowerCase();
  if (/(assignment|quiz|discussion_topic|homework)/.test(hay)) return "assignment";
  // A point-in-time entry with no end is a due date, not a meeting.
  if (!ev.end) return "assignment";
  return "event";
}

/**
 * Turn fetched feed events into store-ready drafts, resolving each event's
 * category from its course name (reusing an existing category when the name
 * matches, otherwise creating one with the next palette color).
 */
export function buildImportPlan(
  { calendarName, events }: FetchedCalendar,
  existingCategories: Category[],
  sourceId: string
): ImportPlan {
  const byName = new Map<string, Category>();
  for (const c of existingCategories) byName.set(c.name.trim().toLowerCase(), c);

  const newCategories: Category[] = [];
  const fallbackName = (calendarName ?? "").trim() || "Imported";

  const resolveCategory = (course: string | null): string => {
    const wanted = (course ?? fallbackName).trim();
    const key = wanted.toLowerCase();
    const hit = byName.get(key);
    if (hit) return hit.id;
    const created: Category = {
      id: nanoid(),
      name: wanted,
      color: PALETTE[(existingCategories.length + newCategories.length) % PALETTE.length],
      sourceId,
    };
    byName.set(key, created);
    newCategories.push(created);
    return created.id;
  };

  const seen = new Set<string>();
  const drafts: ImportedDraft[] = [];
  for (const ev of events) {
    if (seen.has(ev.uid)) continue;
    seen.add(ev.uid);
    const { title, course } = splitCourse(ev.summary);
    const type = detectType(ev);
    drafts.push({
      sourceId,
      sourceUid: ev.uid,
      categoryId: resolveCategory(course),
      type,
      title: title || ev.summary || "Untitled",
      description: ev.description,
      location: ev.location,
      at: ev.start,
      endAt: ev.end,
      allDay: ev.allDay || undefined,
      status: type === "event" ? undefined : "todo",
    });
  }

  return { newCategories, drafts };
}
