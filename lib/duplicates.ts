/**
 * "Study group Thursday 7pm" staged a second card when "Study group meeting"
 * already sat at Thursday 7 PM — in both audit runs, with no comment. Before an
 * add is staged, look for the same thing already on the calendar and let the
 * model ask instead.
 */

export interface DuplicateCandidate {
  id: string;
  title: string;
  at: string;
  type?: string;
}

const WINDOW_MS = 2 * 60 * 60_000;
const STOP = new Set(["the", "a", "an", "of", "and", "with", "for", "to", "my"]);

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

/** Same thing, said differently: one title contains the other, or most words match. */
export function similarTitles(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const shared = [...sa].filter((w) => sb.has(w)).length;
  const smaller = Math.min(sa.size, sb.size);
  // "study group" inside "study group meeting" is the same thing.
  if (shared === smaller && smaller >= 1) return true;
  return shared / (sa.size + sb.size - shared) >= 0.6;
}

export function findPossibleDuplicate(
  items: DuplicateCandidate[],
  proposed: { title: string; at: string },
): DuplicateCandidate | null {
  const at = +new Date(proposed.at);
  if (Number.isNaN(at)) return null;
  for (const item of items) {
    const when = +new Date(item.at);
    if (Number.isNaN(when) || Math.abs(when - at) > WINDOW_MS) continue;
    if (similarTitles(item.title, proposed.title)) return item;
  }
  return null;
}
