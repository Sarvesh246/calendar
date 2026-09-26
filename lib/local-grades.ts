/**
 * Grade arithmetic from a class's syllabus weights. Datebook never stores
 * scores, so every number here comes from what the user just typed; the
 * syllabus only supplies weights and letter cut-offs. Anything we can't pin
 * down (points-based weights, a component we can't find) returns `null` and
 * the model takes it.
 */
import { formatNumber } from "./local-math";
import type { SyllabusGradeCutoff, SyllabusGradeWeight } from "./syllabus-info";

/** "35%" → 0.35. Points ("150 pts") and prose ("drop lowest") → null. */
export function weightFraction(weight: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%/.exec(weight);
  if (!m) return null;
  const v = Number(m[1]) / 100;
  return v > 0 && v <= 1 ? v : null;
}

const STOP = new Set(["the", "my", "a", "an", "on", "in", "for", "of", "exam", "and"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .map((w) => (w.length > 3 ? w.replace(/(?:es|s)$/, "") : w))
    .filter((w) => w && !STOP.has(w));
}

/** The grading row a phrase names: "the final" → "Final exam", "psets" → "Problem sets". */
export function findComponent(grading: SyllabusGradeWeight[], phrase: string): SyllabusGradeWeight | null {
  const want = words(phrase.replace(/\bpsets?\b/g, "problem set").replace(/\bhw\b/g, "homework"));
  if (!want.length) return null;
  const hits = grading.filter((g) => {
    const have = words(g.component);
    return want.every((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
  });
  return hits.length === 1 ? hits[0] : null;
}

const STANDARD: Record<string, number> = { a: 90, b: 80, c: 70, d: 60 };

/** Lowest score for a letter: from the syllabus scale if it has one, else the usual 90/80/70/60. */
export function letterFloor(scale: SyllabusGradeCutoff[], letter: string): { floor: number; fromSyllabus: boolean } | null {
  const want = letter.trim().toUpperCase();
  const row = scale.find((g) => g.grade.trim().toUpperCase() === want);
  const lo = row ? /(\d+(?:\.\d+)?)/.exec(row.range)?.[1] : undefined;
  if (lo) return { floor: Number(lo), fromSyllabus: true };
  const base = STANDARD[want.toLowerCase()];
  return base === undefined ? null : { floor: base, fromSyllabus: false };
}

/** The letter a score earns, highest first. */
export function letterFor(scale: SyllabusGradeCutoff[], score: number): string | null {
  const rows = scale
    .map((g) => ({ grade: g.grade.trim(), lo: Number(/(\d+(?:\.\d+)?)/.exec(g.range)?.[1]) }))
    .filter((r) => Number.isFinite(r.lo))
    .sort((a, b) => b.lo - a.lo);
  const hit = rows.find((r) => score >= r.lo);
  return hit?.grade ?? null;
}

/** Score needed on a component worth `weight` to finish at `target`, given `current` on everything else. */
export function neededScore(current: number, target: number, weight: number): number {
  return (target - current * (1 - weight)) / weight;
}

/**
 * Weighted average of the components the user gave, re-normalised over just
 * those weights (so "psets 92, midterm 81" is their grade *so far*).
 */
export function weightedSoFar(
  grading: SyllabusGradeWeight[],
  scores: Array<{ phrase: string; score: number }>
): { average: number; used: Array<{ component: string; weight: number; score: number }>; covered: number } | null {
  const used: Array<{ component: string; weight: number; score: number }> = [];
  for (const s of scores) {
    const row = findComponent(grading, s.phrase);
    const w = row ? weightFraction(row.weight) : null;
    if (!row || w === null || used.some((u) => u.component === row.component)) return null;
    used.push({ component: row.component, weight: w, score: s.score });
  }
  const covered = used.reduce((a, u) => a + u.weight, 0);
  if (!used.length || covered <= 0) return null;
  const average = used.reduce((a, u) => a + u.score * u.weight, 0) / covered;
  return { average, used, covered };
}

export const fmt = formatNumber;
