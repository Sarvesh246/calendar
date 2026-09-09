import { matchCategory } from "./bulk-parse";
import { isHttpFeedUrl } from "./calendar-import";
import { categoryKey } from "./merge-calendars";
import type { Category, ImportSource, Item, ItemStatus, ItemType } from "./types";

export { matchCategory } from "./bulk-parse";
export { categoryKey } from "./merge-calendars";

/** Confident same-item. Below this but ≥ {@link SYLLABUS_UNCERTAIN_THRESHOLD} is "check these". */
export const SYLLABUS_MATCH_THRESHOLD = 0.72;
/** Below this, the extracted row is new. */
export const SYLLABUS_UNCERTAIN_THRESHOLD = 0.5;

export type SyllabusVerdict = "new" | "matched" | "uncertain";
/** Review-sheet choice once the matcher has grouped a row. */
export type SyllabusRowDecision = "import" | "skip" | "link";

/** One dated row from a syllabus extract, already converted to an ISO instant. */
export interface SyllabusDraft {
  title: string;
  at: string;
  endAt?: string;
  allDay?: boolean;
  type: ItemType;
  notes?: string;
  kind?: string;
}

export interface SyllabusMatch {
  draft: SyllabusDraft;
  verdict: SyllabusVerdict;
  score: number;
  existing?: Item;
}

export type SyllabusCourseResolve =
  | { status: "forced"; categoryId: string; warning?: string }
  | { status: "matched"; categoryId: string }
  | { status: "create"; name: string };

const FILLER = /\b(due|submit|assignment|submitted|submitting)\b/g;
const KIND_NUM =
  /\b(?:homework|problem set|quiz|exam|midterm|final|lab|essay|paper|project|assignment|reading|discussion)\s+(\d+)\b/g;
const COURSE_CODE = /\b([A-Za-z]{2,5})[\s-]?(\d{2,4})\b/;

/** Local calendar day as yyyy-MM-dd in an IANA timezone. */
export function zonedDateKey(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export function isSyllabusSourceUrl(url: string): boolean {
  return /^syllabus:\/\//i.test(url.trim());
}

export function isSyllabusSource(source: { url: string }): boolean {
  return isSyllabusSourceUrl(source.url);
}

/** Synthetic ImportSource URL for one class — same key the feed importer uses. */
export function syllabusSourceUrl(categoryName: string): string {
  return `syllabus://${categoryKey(categoryName)}`;
}

export function isSyllabusSourceUid(uid: string | undefined): boolean {
  return Boolean(uid?.startsWith("syl:"));
}

/** Stable identity for a syllabus row: `syl:{date}:{fingerprint}`. */
export function syllabusSourceUid(title: string, at: string, timeZone: string): string {
  const day = zonedDateKey(at, timeZone);
  return `syl:${day}:${fingerprint(normalizeSyllabusTitle(title))}`;
}

export function groupSyllabusMatches(matches: SyllabusMatch[]): {
  newItems: SyllabusMatch[];
  already: SyllabusMatch[];
  check: SyllabusMatch[];
} {
  const newItems: SyllabusMatch[] = [];
  const already: SyllabusMatch[] = [];
  const check: SyllabusMatch[] = [];
  for (const m of matches) {
    if (m.verdict === "new") newItems.push(m);
    else if (m.verdict === "matched") already.push(m);
    else check.push(m);
  }
  return { newItems, already, check };
}

export function summarizeSyllabusMatches(matches: SyllabusMatch[]): {
  newCount: number;
  alreadyCount: number;
  checkCount: number;
} {
  const g = groupSyllabusMatches(matches);
  return {
    newCount: g.newItems.length,
    alreadyCount: g.already.length,
    checkCount: g.check.length,
  };
}

export function defaultSyllabusDecision(verdict: SyllabusVerdict): SyllabusRowDecision {
  if (verdict === "new") return "import";
  if (verdict === "matched") return "link";
  return "skip";
}

/**
 * Pin every row to a Settings category, or file a shared drop against an
 * existing class (full name or course code). No match → mint later.
 */
export function resolveSyllabusCourse(input: {
  categories: Category[];
  courseName?: string;
  courseCode?: string;
  forceCategoryId?: string;
}): SyllabusCourseResolve {
  const courseName = input.courseName?.trim() || "";
  const courseCode = input.courseCode?.trim() || "";
  const haystack = [courseName, courseCode].filter(Boolean).join(" ");
  const forced = input.forceCategoryId
    ? input.categories.find((c) => c.id === input.forceCategoryId)
    : undefined;

  if (forced) {
    return {
      status: "forced",
      categoryId: forced.id,
      warning: courseDisagreement(forced, haystack, input.categories, courseName, courseCode),
    };
  }

  if (courseName) {
    const key = categoryKey(courseName);
    const byName = input.categories.find((c) => categoryKey(c.name) === key);
    if (byName) return { status: "matched", categoryId: byName.id };
  }
  if (courseCode) {
    const key = categoryKey(courseCode);
    const byCode = input.categories.find((c) => categoryKey(c.name) === key);
    if (byCode) return { status: "matched", categoryId: byCode.id };
  }
  if (haystack) {
    const id = matchCategory(haystack, input.categories);
    if (id) return { status: "matched", categoryId: id };
  }

  const name = courseName || courseCode || "Imported";
  return { status: "create", name };
}

/**
 * Score each extracted row against items already on that class.
 *
 * Same calendar day (then equal-title ±1 day for the all-day timezone edge),
 * assignment-number veto, then exact / containment / token Dice. Greedy
 * one-to-one; leftover extracts that still score as a match against a claimed
 * row are "already in Datebook" so duplicate syllabus lines don't mint twins.
 */
export function matchSyllabusItems(
  drafts: SyllabusDraft[],
  existing: Item[],
  options: { timeZone: string; categoryId?: string }
): SyllabusMatch[] {
  const timeZone = options.timeZone;
  const pool = options.categoryId
    ? existing.filter((i) => i.categoryId === options.categoryId)
    : existing;

  const byUid = new Map<string, Item>();
  for (const item of pool) {
    if (item.sourceUid && isSyllabusSourceUid(item.sourceUid) && !byUid.has(item.sourceUid)) {
      byUid.set(item.sourceUid, item);
    }
  }

  const matches: SyllabusMatch[] = drafts.map((draft) => {
    const uid = syllabusSourceUid(draft.title, draft.at, timeZone);
    const hit = byUid.get(uid);
    if (hit) {
      byUid.delete(uid);
      return { draft, verdict: "matched" as const, score: 1, existing: hit };
    }
    return { draft, verdict: "new" as const, score: 0 };
  });

  const claimedItems = new Set(
    matches.filter((m) => m.existing).map((m) => m.existing!.id)
  );
  const claimedDrafts = new Set<number>();
  matches.forEach((m, i) => {
    if (m.verdict === "matched" && m.score === 1 && m.existing && isSyllabusSourceUid(m.existing.sourceUid)) {
      claimedDrafts.add(i);
    }
  });

  type Pair = { di: number; item: Item; score: number };
  const pairs: Pair[] = [];
  matches.forEach((m, di) => {
    if (claimedDrafts.has(di)) return;
    const draftNorm = parseTitle(m.draft.title);
    const draftDay = zonedDateKey(m.draft.at, timeZone);
    for (const item of pool) {
      if (claimedItems.has(item.id)) continue;
      const itemNorm = parseTitle(item.title);
      if (numbersVeto(draftNorm.numbers, itemNorm.numbers)) continue;
      const itemDay = zonedDateKey(item.at, timeZone);
      const sameDay = draftDay === itemDay;
      const exactTitle = draftNorm.text.length > 0 && draftNorm.text === itemNorm.text;
      const dayGap = Math.abs(dateKeyDiff(draftDay, itemDay));
      if (!sameDay && !(exactTitle && dayGap === 1)) continue;
      const score = exactTitle && (sameDay || dayGap === 1) ? 1 : titleScore(draftNorm.text, itemNorm.text);
      if (score < SYLLABUS_UNCERTAIN_THRESHOLD) continue;
      pairs.push({ di, item, score });
    }
  });

  pairs.sort((a, b) => b.score - a.score || a.di - b.di || (a.item.id < b.item.id ? -1 : 1));

  for (const pair of pairs) {
    if (claimedDrafts.has(pair.di) || claimedItems.has(pair.item.id)) continue;
    claimedDrafts.add(pair.di);
    claimedItems.add(pair.item.id);
    matches[pair.di] = {
      draft: matches[pair.di].draft,
      verdict: pair.score >= SYLLABUS_MATCH_THRESHOLD ? "matched" : "uncertain",
      score: pair.score,
      existing: pair.item,
    };
  }

  // Duplicate extracts whose best target was already claimed: still "already"
  // when the score is a confident match, so the review sheet doesn't offer a twin.
  matches.forEach((m, di) => {
    if (m.verdict !== "new") return;
    const draftNorm = parseTitle(m.draft.title);
    const draftDay = zonedDateKey(m.draft.at, timeZone);
    let best: { item: Item; score: number } | undefined;
    for (const item of pool) {
      const itemNorm = parseTitle(item.title);
      if (numbersVeto(draftNorm.numbers, itemNorm.numbers)) continue;
      const itemDay = zonedDateKey(item.at, timeZone);
      const sameDay = draftDay === itemDay;
      const exactTitle = draftNorm.text.length > 0 && draftNorm.text === itemNorm.text;
      const dayGap = Math.abs(dateKeyDiff(draftDay, itemDay));
      if (!sameDay && !(exactTitle && dayGap === 1)) continue;
      const score = exactTitle && (sameDay || dayGap === 1) ? 1 : titleScore(draftNorm.text, itemNorm.text);
      if (!best || score > best.score) best = { item, score };
    }
    if (!best) return;
    if (best.score >= SYLLABUS_MATCH_THRESHOLD) {
      matches[di] = { draft: m.draft, verdict: "matched", score: best.score, existing: best.item };
    } else if (best.score >= SYLLABUS_UNCERTAIN_THRESHOLD) {
      matches[di] = { draft: m.draft, verdict: "uncertain", score: best.score, existing: best.item };
    }
  });

  return matches;
}

/**
 * After a syllabus apply *or* an ICS re-sync: if a Canvas row landed on top of
 * a syllabus copy of the same work, keep the feed row (URL + UID), fold status
 * from the syllabus copy, and drop the syllabus row.
 */
export function collapseCrossSourceDuplicates(
  items: Item[],
  sources: ImportSource[],
  timeZone: string,
  now = new Date().toISOString()
): { items: Item[]; dropped: string[] } {
  const urlById = new Map(sources.map((s) => [s.id, s.url]));
  const syllabusItems = items.filter((i) => isSyllabusRow(i, urlById));
  const feedItems = items.filter((i) => isFeedRow(i, urlById));
  if (syllabusItems.length === 0 || feedItems.length === 0) {
    return { items, dropped: [] };
  }

  const byCategory = new Map<string, Item[]>();
  for (const item of feedItems) {
    const bucket = byCategory.get(item.categoryId);
    if (bucket) bucket.push(item);
    else byCategory.set(item.categoryId, [item]);
  }

  const dropped: string[] = [];
  const keepFeed = new Map<string, Item>();
  const dropSyllabus = new Set<string>();

  // Match per category so two classes' "Homework 3" on the same day stay apart.
  const categoryIds = new Set([
    ...syllabusItems.map((i) => i.categoryId),
    ...feedItems.map((i) => i.categoryId),
  ]);
  for (const categoryId of categoryIds) {
    const syl = syllabusItems.filter((i) => i.categoryId === categoryId);
    const feed = byCategory.get(categoryId) ?? [];
    if (syl.length === 0 || feed.length === 0) continue;
    const catDrafts: SyllabusDraft[] = syl.map((i) => ({
      title: i.title,
      at: i.at,
      type: i.type,
      ...(i.endAt ? { endAt: i.endAt } : {}),
      ...(i.allDay ? { allDay: true } : {}),
      ...(i.description ? { notes: i.description } : {}),
    }));
    const results = matchSyllabusItems(catDrafts, feed, { timeZone, categoryId });
    results.forEach((m, idx) => {
      if (m.verdict !== "matched" || !m.existing) return;
      const syllabusRow = syl[idx];
      const feedRow = keepFeed.get(m.existing.id) ?? m.existing;
      keepFeed.set(feedRow.id, foldSyllabusIntoFeed(feedRow, syllabusRow, now));
      dropSyllabus.add(syllabusRow.id);
      dropped.push(syllabusRow.id);
    });
  }

  if (dropped.length === 0) return { items, dropped: [] };

  const out: Item[] = [];
  for (const item of items) {
    if (dropSyllabus.has(item.id)) continue;
    out.push(keepFeed.get(item.id) ?? item);
  }
  return { items: out, dropped };
}

export function normalizeSyllabusTitle(title: string): string {
  return parseTitle(title).text;
}

export function syllabusTitleScore(a: string, b: string): number {
  return titleScore(parseTitle(a).text, parseTitle(b).text);
}

function parseTitle(title: string): { text: string; numbers: Set<number> } {
  let s = title.toLowerCase().replace(/[​ ]/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = expandAbbreviations(s);
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const numbers = assignmentNumbers(s);
  const stripped = s.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return { text: stripped || s, numbers };
}

function expandAbbreviations(s: string): string {
  return s
    .replace(/\bpsets?(?=\d)/gi, "problem set ")
    .replace(/\bpsets?\b/gi, "problem set")
    .replace(/\bh\.?\s*w\.?(?=\d)/gi, "homework ")
    .replace(/\bh\.?\s*w\.?\b/gi, "homework")
    .replace(/\bps(?=\d)/gi, "problem set ")
    .replace(/\bps\b/gi, "problem set");
}

function assignmentNumbers(normalized: string): Set<number> {
  const out = new Set<number>();
  KIND_NUM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KIND_NUM.exec(normalized))) {
    out.add(Number(m[1]));
  }
  return out;
}

function numbersVeto(a: Set<number>, b: Set<number>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const n of a) if (b.has(n)) return false;
  return true;
}

function titleScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = tokens(a);
  const bt = tokens(b);
  const dice = tokenDice(at, bt);
  let best = dice;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const shortTokens = at.length <= bt.length ? at : bt;
  const longTokens = at.length <= bt.length ? bt : at;
  const subset =
    shortTokens.length >= 2 && shortTokens.every((t) => longTokens.includes(t));
  if (subset) best = Math.max(best, 0.85);
  if (longer.includes(shorter) && (shortTokens.length >= 2 || shorter.length >= 6)) {
    best = Math.max(best, 0.72 + 0.28 * (shorter.length / longer.length));
  }
  return best;
}

function tokens(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const bCounts = new Map<string, number>();
  for (const t of b) bCounts.set(t, (bCounts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of a) {
    const n = bCounts.get(t) ?? 0;
    if (n > 0) {
      overlap += 1;
      bCounts.set(t, n - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function dateKeyDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function courseCodeOf(text: string): string | undefined {
  const m = text.match(COURSE_CODE);
  return m ? `${m[1].toUpperCase()}${m[2]}` : undefined;
}

function courseDisagreement(
  forced: Category,
  haystack: string,
  categories: Category[],
  courseName: string,
  courseCode: string
): string | undefined {
  if (!haystack) return undefined;
  const other = matchCategory(haystack, categories);
  if (other && other !== forced.id) {
    const name = categories.find((c) => c.id === other)?.name ?? haystack;
    return `This syllabus looks like ${name}, not ${forced.name}.`;
  }
  const forcedCode = courseCodeOf(forced.name);
  const extractedCode = courseCodeOf(haystack) ?? courseCodeOf(courseCode) ?? courseCodeOf(courseName);
  if (forcedCode && extractedCode && forcedCode !== extractedCode) {
    return `This syllabus looks like ${extractedCode.replace(/(\D+)(\d+)/, "$1 $2")}, not ${forced.name}.`;
  }
  return undefined;
}

function isSyllabusRow(item: Item, urlById: Map<string, string>): boolean {
  if (isSyllabusSourceUid(item.sourceUid)) return true;
  const url = item.sourceId ? urlById.get(item.sourceId) : undefined;
  return Boolean(url && isSyllabusSourceUrl(url));
}

function isFeedRow(item: Item, urlById: Map<string, string>): boolean {
  if (isSyllabusRow(item, urlById)) return false;
  const url = item.sourceId ? urlById.get(item.sourceId) : undefined;
  return Boolean(url && isHttpFeedUrl(url));
}

function foldSyllabusIntoFeed(feed: Item, syllabus: Item, now: string): Item {
  const next: Item = { ...withStatusFrom(feed, pickStatusFrom(feed, syllabus)), updatedAt: now };
  if (!next.description?.trim() && syllabus.description?.trim()) {
    next.description = syllabus.description;
  }
  return next;
}

function pickStatusFrom(a: Item, b: Item): Item {
  const at = time(a.statusAt ?? a.completedAt);
  const bt = time(b.statusAt ?? b.completedAt);
  if (at !== bt) return at > bt ? a : b;
  const rank = (s: Item["status"]) => (s === "done" ? 2 : s === "doing" ? 1 : 0);
  const ar = rank(a.status);
  const br = rank(b.status);
  if (ar !== br) return ar > br ? a : b;
  return a;
}

function withStatusFrom(base: Item, statusSide: Item): Item {
  if (statusSide.status === base.status && statusSide.completedAt === base.completedAt) {
    return base;
  }
  const next: Item = { ...base, status: statusSide.status as ItemStatus | undefined };
  if (statusSide.completedAt) next.completedAt = statusSide.completedAt;
  else delete next.completedAt;
  if (statusSide.statusAt) next.statusAt = statusSide.statusAt;
  else delete next.statusAt;
  return next;
}

function time(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
