import { TAB_ROUTES, type TabRoute } from "./tab-routes";
import { appleSpring, type SpringTransition } from "./motion";
import { project, rubberband } from "./gesture";

const PAGE_SWIPE_IGNORE =
  'input, textarea, select, option, [contenteditable="true"], [data-page-swipe="off"], .mobile-tab-bar';

export const PAGE_SWIPE_AXIS = 10;
export const PAGE_SWIPE_HALFWAY = 0.5;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** True when a page-swipe must not steal this pointer. */
export function pageSwipeIgnores(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest(PAGE_SWIPE_IGNORE));
}

/**
 * Past the first or last tab the page yields instead of sticking — Apple's
 * asymptotic rubber-band, so a long overdrag stiffens rather than stretching
 * like taffy — then springs home.
 */
export function rubberbandPageX(dx: number, index: number, count: number, width: number): number {
  if (index <= 0 && dx > 0) return rubberband(dx, width);
  if (index >= count - 1 && dx < 0) return rubberband(dx, width);
  return dx;
}

/**
 * Which tab a horizontal page swipe should land on.
 *
 * One rule instead of "past halfway, or a fast enough flick": project where
 * the page would coast to at the release speed and commit if that crosses the
 * halfway point. A short quick throw and a long slow drag are judged on the
 * same scale, and a drag that is being pulled *back* when released (velocity
 * against the offset) stays home even if it was past halfway.
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
  const projected = project(dx, vx);
  let next = startIndex;
  if (projected > width * PAGE_SWIPE_HALFWAY && dx > 0) next = startIndex - 1;
  else if (projected < -width * PAGE_SWIPE_HALFWAY && dx < 0) next = startIndex + 1;
  return clamp(next, 0, count - 1);
}

export function neighbourTab(index: number, dx: number): TabRoute | null {
  if (dx > 0) return TAB_ROUTES[index - 1] ?? null;
  if (dx < 0) return TAB_ROUTES[index + 1] ?? null;
  return null;
}

/**
 * Which tab a thrown nav pill should land on: where the pill would coast to,
 * rounded to the nearest tab, never more than one tab past where the finger
 * let go.
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
  const released = startIndex + Math.round(offset / tabWidth);
  const coasted = startIndex + Math.round(project(offset, velocity) / tabWidth);
  const next = clamp(coasted, released - 1, released + 1);
  return clamp(next, 0, count - 1);
}

/**
 * One slightly under-damped spring that is handed the finger's leftover
 * speed. A harder throw naturally overshoots more; a careful drag barely does.
 * (The old version switched between three springs at speed thresholds, so two
 * nearly identical flicks could land completely differently.)
 */
export function pillSpringForVelocity(velocity: number): SpringTransition {
  return { ...appleSpring(0.36, 0.74), velocity };
}

export function pageSpringForVelocity(velocity: number): SpringTransition {
  return { ...appleSpring(0.42, 0.9), velocity };
}
