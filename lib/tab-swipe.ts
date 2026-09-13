import { TAB_ROUTES, type TabRoute } from "./tab-routes";

const PAGE_SWIPE_IGNORE =
  'input, textarea, select, option, [contenteditable="true"], [data-page-swipe="off"], .mobile-tab-bar';

export const PAGE_SWIPE_AXIS = 14;
export const PAGE_SWIPE_HALFWAY = 0.42;
export const PAGE_SWIPE_FLICK = 720;
export const PAGE_SWIPE_FLICK_MIN = 28;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** True when a page-swipe must not steal this pointer. */
export function pageSwipeIgnores(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest(PAGE_SWIPE_IGNORE));
}

/**
 * Rubber-band a drag past the first or last tab so the page yields
 * instead of sticking, then springs home.
 */
export function rubberbandPageX(dx: number, index: number, count: number): number {
  if (index <= 0 && dx > 0) return dx * 0.22;
  if (index >= count - 1 && dx < 0) return dx * 0.22;
  return dx;
}

/**
 * Which tab a horizontal page swipe should land on.
 *
 * Slow drags respect the halfway point: release before it and the page
 * comes back; release after it and the neighbour commits. A flick with
 * real speed can take the neighbour before halfway — the same reading a
 * native pager gives a thrown card.
 */
export function commitPageFromGesture({
  startIndex,
  dx,
  vx,
  width,
  count,
}: {
  startIndex: number;
  dx: number;
  vx: number;
  width: number;
  count: number;
}): number {
  if (width <= 0) return startIndex;
  const flicked = Math.abs(vx) > PAGE_SWIPE_FLICK && Math.abs(dx) > PAGE_SWIPE_FLICK_MIN;
  let next = startIndex;
  if (dx > width * PAGE_SWIPE_HALFWAY || (flicked && dx > 0 && vx > 0)) next = startIndex - 1;
  else if (dx < -width * PAGE_SWIPE_HALFWAY || (flicked && dx < 0 && vx < 0)) next = startIndex + 1;
  return clamp(next, 0, count - 1);
}

export function neighbourTab(index: number, dx: number): TabRoute | null {
  if (dx > 0) return TAB_ROUTES[index - 1] ?? null;
  if (dx < 0) return TAB_ROUTES[index + 1] ?? null;
  return null;
}

/**
 * Which tab a thrown nav pill should land on.
 *
 * Position still wins for a slow drag (round to nearest). A flick that
 * has already travelled a tenth of a tab commits in the throw's
 * direction even if it hasn't crossed the midpoint — otherwise a fast
 * swipe that looks decisive snaps back, which is the stutter.
 */
export function commitTabFromGesture({
  startIndex,
  offset,
  velocity,
  tabWidth,
  count,
}: {
  startIndex: number;
  offset: number;
  velocity: number;
  tabWidth: number;
  count: number;
}): number {
  if (tabWidth <= 0) return startIndex;
  const flicked = Math.abs(velocity) > 800 && Math.abs(offset) > tabWidth * 0.1;
  const next = flicked
    ? startIndex + Math.sign(offset !== 0 ? offset : velocity)
    : startIndex + Math.round(offset / tabWidth);
  return clamp(next, 0, count - 1);
}

/** Spring the pill with the finger's leftover speed, so a throw bounces. */
export function pillSpringForVelocity(velocity: number) {
  const abs = Math.abs(velocity);
  if (abs > 1800) {
    return { type: "spring" as const, stiffness: 320, damping: 20, mass: 0.8, velocity };
  }
  if (abs > 900) {
    return { type: "spring" as const, stiffness: 380, damping: 26, mass: 0.7, velocity };
  }
  return { type: "spring" as const, stiffness: 480, damping: 36, mass: 0.55, velocity };
}

export function pageSpringForVelocity(velocity: number) {
  const abs = Math.abs(velocity);
  if (abs > 1400) {
    return { type: "spring" as const, stiffness: 300, damping: 28, mass: 0.9, velocity };
  }
  if (abs > 700) {
    return { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.8, velocity };
  }
  return { type: "spring" as const, stiffness: 460, damping: 40, mass: 0.7, velocity };
}
