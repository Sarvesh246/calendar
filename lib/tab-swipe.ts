import { motionValue } from "framer-motion";

export const TAB_HREFS = ["/today", "/calendar", "/agenda"] as const;

export type TabHref = (typeof TAB_HREFS)[number];

/** Shared x offset of the current tab page while the finger is still down. */
export const tabPageX = motionValue(0);

export type TabTransition = {
  enterX: number;
  exitX: number;
  fromSwipe: boolean;
};

export const tabTransition: TabTransition = {
  enterX: 0,
  exitX: 0,
  fromSwipe: false,
};

type DragSnap = { dragging: boolean; origin: string };

let dragSnap: DragSnap = { dragging: false, origin: "" };
const dragListeners = new Set<() => void>();

function emitDrag() {
  dragListeners.forEach((fn) => fn());
}

export function beginTabDrag(originPath: string) {
  dragSnap = { dragging: true, origin: originPath };
  emitDrag();
}

export function endTabDrag() {
  if (!dragSnap.dragging) return;
  dragSnap = { dragging: false, origin: dragSnap.origin };
  emitDrag();
}

export function getTabDragSnap() {
  return dragSnap;
}

export function subscribeTabDrag(fn: () => void) {
  dragListeners.add(fn);
  return () => {
    dragListeners.delete(fn);
  };
}

export function tabIndexForPath(pathname: string) {
  const i = TAB_HREFS.indexOf(pathname as TabHref);
  return i;
}

export function snapTabIndex(from: number, dx: number, tabWidth: number, count: number) {
  if (!tabWidth || count <= 0) return from;
  return Math.max(0, Math.min(count - 1, Math.round(from + dx / tabWidth)));
}

/**
 * Snapshot the in-flight swipe so the incoming route can continue from the
 * same x instead of cutting in at 0.
 */
export function prepareTabTransition(fromIndex: number, toIndex: number, currentX: number) {
  const dir = toIndex === fromIndex ? 0 : toIndex > fromIndex ? 1 : -1;
  const width = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0;
  const fromSwipe = Math.abs(currentX) > 12 && width > 0;

  if (dir === 0) {
    tabTransition.enterX = 0;
    tabTransition.exitX = 0;
    tabTransition.fromSwipe = false;
    return dir;
  }

  if (fromSwipe) {
    tabTransition.enterX = currentX + dir * width;
    tabTransition.exitX = -dir * width;
  } else {
    const peek = Math.min(64, width > 0 ? width * 0.16 : 64);
    tabTransition.enterX = dir * peek;
    tabTransition.exitX = -dir * peek;
  }
  tabTransition.fromSwipe = fromSwipe;
  return dir;
}

export function resetTabTransition() {
  tabTransition.enterX = 0;
  tabTransition.exitX = 0;
  tabTransition.fromSwipe = false;
}
