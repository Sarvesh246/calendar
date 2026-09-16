import { clearDraft, readJsonDraft, writeJsonDraft } from "./drafts";
import {
  focusQueue,
  isDueOnDay,
  isOverdueAt,
} from "./date-utils";
import type { Category, Item } from "./types";

export const FOCUS_SESSION_DRAFT_KEY = "focus-session" as const;
export const COUNTDOWN_MS = { 25: 25 * 60_000, 45: 45 * 60_000 } as const;

export type FocusClock = "stopwatch" | "countdown";
export type CountdownPreset = 25 | 45;

export interface FocusSegment {
  itemId: string;
  startedAt: number;
  accumulatedMs: number;
  pausedAt?: number;
}

export interface FocusSession {
  clock: FocusClock;
  durationMs: number | null;
  targetEndsAt: number | null;
  segments: FocusSegment[];
  activeItemId: string | null;
  overtimeNotified?: boolean;
}

export function emptySession(activeItemId: string | null, now = Date.now()): FocusSession {
  return {
    clock: "stopwatch",
    durationMs: null,
    targetEndsAt: null,
    segments: activeItemId ? [idleSegment(activeItemId, now)] : [],
    activeItemId,
  };
}

export function idleSegment(itemId: string, now = Date.now()): FocusSegment {
  return { itemId, startedAt: now, accumulatedMs: 0, pausedAt: now };
}

export function activeSegment(session: FocusSession): FocusSegment | undefined {
  if (!session.activeItemId) return undefined;
  for (let i = session.segments.length - 1; i >= 0; i--) {
    if (session.segments[i].itemId === session.activeItemId) return session.segments[i];
  }
  return undefined;
}

export function isRunning(session: FocusSession): boolean {
  const seg = activeSegment(session);
  return Boolean(seg && seg.pausedAt == null);
}

/** Wall-clock used for countdown display — frozen while paused. */
export function clockNow(session: FocusSession, now: number): number {
  const seg = activeSegment(session);
  return seg?.pausedAt ?? now;
}

export function segmentElapsedMs(seg: FocusSegment, now: number): number {
  if (seg.pausedAt != null) return Math.max(0, seg.accumulatedMs);
  return Math.max(0, seg.accumulatedMs + (now - seg.startedAt));
}

export function itemElapsedMs(session: FocusSession, itemId: string, now: number): number {
  let total = 0;
  for (const seg of session.segments) {
    if (seg.itemId === itemId) total += segmentElapsedMs(seg, now);
  }
  return total;
}

export function sessionElapsedMs(session: FocusSession, now: number): number {
  let total = 0;
  for (const seg of session.segments) total += segmentElapsedMs(seg, now);
  return total;
}

export function timedItemCount(session: FocusSession, now: number): number {
  const ids = new Set(session.segments.map((s) => s.itemId));
  let n = 0;
  for (const id of ids) if (itemElapsedMs(session, id, now) > 0) n += 1;
  return n;
}

export function isSessionLive(session: FocusSession | null, now = Date.now()): boolean {
  if (!session) return false;
  return isRunning(session) || sessionElapsedMs(session, now) > 0;
}

export type ClockFace = { kind: "stopwatch" | "remaining" | "overtime"; ms: number };

export function countdownRemainingMs(session: FocusSession, now: number): number | null {
  if (session.clock !== "countdown" || session.durationMs == null) return null;
  if (session.targetEndsAt != null) return session.targetEndsAt - clockNow(session, now);
  return session.durationMs;
}

export function clockFace(session: FocusSession, now: number): ClockFace {
  if (session.clock === "countdown" && session.durationMs != null) {
    const remaining = countdownRemainingMs(session, now) ?? session.durationMs;
    if (remaining > 0) return { kind: "remaining", ms: remaining };
    if (session.targetEndsAt != null) {
      return { kind: "overtime", ms: Math.max(0, clockNow(session, now) - session.targetEndsAt) };
    }
    return { kind: "remaining", ms: session.durationMs };
  }
  const id = session.activeItemId;
  return { kind: "stopwatch", ms: id ? itemElapsedMs(session, id, now) : 0 };
}

export function formatFocusClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatClockFace(face: ClockFace): string {
  const body = formatFocusClock(face.ms);
  return face.kind === "overtime" ? `+${body}` : body;
}

function lastIndexFor(segments: FocusSegment[], itemId: string | null): number {
  if (!itemId) return -1;
  for (let i = segments.length - 1; i >= 0; i--) if (segments[i].itemId === itemId) return i;
  return -1;
}

function patchActive(session: FocusSession, fn: (seg: FocusSegment) => FocusSegment): FocusSegment[] {
  const idx = lastIndexFor(session.segments, session.activeItemId);
  if (idx < 0) return session.segments;
  return session.segments.map((seg, i) => (i === idx ? fn(seg) : seg));
}

function pauseSegment(seg: FocusSegment, now: number): FocusSegment {
  if (seg.pausedAt != null) return seg;
  return { ...seg, accumulatedMs: segmentElapsedMs(seg, now), pausedAt: now };
}

function resumeSegment(seg: FocusSegment, now: number): FocusSegment {
  if (seg.pausedAt == null) return seg;
  return { itemId: seg.itemId, startedAt: now, accumulatedMs: seg.accumulatedMs };
}

export function pauseClock(session: FocusSession, now: number): FocusSession {
  if (!isRunning(session)) return session;
  return { ...session, segments: patchActive(session, (seg) => pauseSegment(seg, now)) };
}

export function startClock(session: FocusSession, now: number): FocusSession {
  if (!session.activeItemId) return session;
  if (isRunning(session)) return session;
  const withSeg =
    lastIndexFor(session.segments, session.activeItemId) < 0
      ? { ...session, segments: [...session.segments, idleSegment(session.activeItemId, now)] }
      : session;
  let targetEndsAt = withSeg.targetEndsAt;
  if (withSeg.clock === "countdown" && withSeg.durationMs != null) {
    const leftover = countdownRemainingMs(withSeg, now) ?? withSeg.durationMs;
    targetEndsAt = now + leftover;
  }
  return {
    ...withSeg,
    targetEndsAt,
    segments: patchActive(withSeg, (seg) => resumeSegment(seg, now)),
  };
}

export function toggleClock(session: FocusSession, now: number): FocusSession {
  return isRunning(session) ? pauseClock(session, now) : startClock(session, now);
}

export function setClockMode(
  session: FocusSession,
  mode: FocusClock,
  durationMs: number | null,
  now: number
): FocusSession {
  const running = isRunning(session);
  if (mode === "stopwatch") {
    return { ...session, clock: "stopwatch", durationMs: null, targetEndsAt: null, overtimeNotified: false };
  }
  const duration = durationMs ?? COUNTDOWN_MS[25];
  return {
    ...session,
    clock: "countdown",
    durationMs: duration,
    targetEndsAt: running ? now + duration : null,
    overtimeNotified: false,
  };
}

export function switchActive(session: FocusSession, itemId: string, now: number): FocusSession {
  if (session.activeItemId === itemId) return session;
  const running = isRunning(session);
  const paused = pauseClock(session, now);
  const nextSeg: FocusSegment = running
    ? { itemId, startedAt: now, accumulatedMs: 0 }
    : idleSegment(itemId, now);
  return { ...paused, activeItemId: itemId, segments: [...paused.segments, nextSeg] };
}

export function closeActiveAndSelect(session: FocusSession, nextItemId: string | null, now: number): FocusSession {
  const paused = pauseClock(session, now);
  if (!nextItemId) return { ...paused, activeItemId: null };
  if (paused.activeItemId === nextItemId) return paused;
  return { ...paused, activeItemId: nextItemId, segments: [...paused.segments, idleSegment(nextItemId, now)] };
}

export function markOvertimeNotified(session: FocusSession): FocusSession {
  return session.overtimeNotified ? session : { ...session, overtimeNotified: true };
}

export function defaultFocusItem(
  items: Item[],
  now = new Date(),
  categories: Pick<Category, "id" | "name">[] = []
): Item | undefined {
  const open = items.filter((i) => i.status !== "done");
  const doing = open.find((i) => i.type !== "event" && i.status === "doing");
  if (doing) return doing;
  return focusQueue(open, now, categories).current;
}

export function rankFocusItems(
  items: Item[],
  now = new Date(),
  categories: Pick<Category, "id" | "name">[] = []
): Item[] {
  const open = items.filter((i) => i.status !== "done");
  const suggested = focusQueue(open, now, categories);
  const doing = open.filter((i) => i.type !== "event" && i.status === "doing");
  const overdue = open.filter((i) => isOverdueAt(i, now) && !isDueOnDay(i, now));
  const dueToday = open.filter((i) => i.type !== "event" && isDueOnDay(i, now) && i.status !== "done");
  const rest = [...open].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const seen = new Set<string>();
  const out: Item[] = [];
  const add = (list: (Item | undefined)[]) => {
    for (const item of list) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  };
  add(doing);
  add([suggested.current, suggested.next]);
  add(overdue);
  add(dueToday);
  add(rest);
  return out;
}

export function nextAfterComplete(
  items: Item[],
  completedId: string,
  now = new Date(),
  categories: Pick<Category, "id" | "name">[] = []
): Item | undefined {
  return defaultFocusItem(
    items.filter((i) => i.id !== completedId),
    now,
    categories
  );
}

function isSegment(value: unknown): value is FocusSegment {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.itemId !== "string" || !v.itemId) return false;
  if (typeof v.startedAt !== "number" || !Number.isFinite(v.startedAt)) return false;
  if (typeof v.accumulatedMs !== "number" || !Number.isFinite(v.accumulatedMs)) return false;
  if (v.pausedAt != null && (typeof v.pausedAt !== "number" || !Number.isFinite(v.pausedAt))) return false;
  return true;
}

export function isFocusSession(value: unknown): value is FocusSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.clock !== "stopwatch" && v.clock !== "countdown") return false;
  if (v.durationMs != null && (typeof v.durationMs !== "number" || !Number.isFinite(v.durationMs))) return false;
  if (v.targetEndsAt != null && (typeof v.targetEndsAt !== "number" || !Number.isFinite(v.targetEndsAt))) return false;
  if (v.activeItemId != null && typeof v.activeItemId !== "string") return false;
  if (!Array.isArray(v.segments) || !v.segments.every(isSegment)) return false;
  if (v.overtimeNotified != null && typeof v.overtimeNotified !== "boolean") return false;
  return true;
}

export function loadFocusSession(): FocusSession | null {
  return readJsonDraft(FOCUS_SESSION_DRAFT_KEY, isFocusSession);
}

export function saveFocusSession(session: FocusSession | null) {
  if (!session) {
    clearDraft(FOCUS_SESSION_DRAFT_KEY);
    return;
  }
  writeJsonDraft(FOCUS_SESSION_DRAFT_KEY, session);
}
