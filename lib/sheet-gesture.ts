"use client";

import { useEffect, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DragControls } from "framer-motion";
import { nearestSnap, project } from "./gesture";

const OVERSCROLL_IGNORE = "input, textarea, select, option, [contenteditable='true']";

/** A decisive downward flick (px/s) closes from anywhere below the top detent. */
export const SHEET_FLICK_CLOSE = 650;

export type SheetRelease = { kind: "close" } | { kind: "snap"; index: number };

/**
 * Where a released sheet goes. Judged on where it would coast to
 * (`project`), so a short quick flick and a long slow pull are read on one
 * scale: past ~40% of the way from the lowest detent to off-screen (capped at
 * 200px) it closes, otherwise it lands on the nearest detent. A pull that is
 * heading back up when you let go never closes.
 *
 * `points` are resting offsets from fully open, top first; `at` is the
 * sheet's current offset; `height` is the sheet's height.
 */
export function sheetRelease({
  at,
  velocity,
  height,
  points,
}: {
  at: number;
  velocity: number;
  height: number;
  points: number[];
}): SheetRelease {
  const last = points[points.length - 1] ?? 0;
  const projected = project(at, velocity);
  const closeAt = last + Math.min(Math.max(0, height - last) * 0.4, 200);
  if ((velocity > SHEET_FLICK_CLOSE && at > last) || (projected > closeAt && velocity > -200)) {
    return { kind: "close" };
  }
  return { kind: "snap", index: points.indexOf(nearestSnap(projected, points)) };
}

/**
 * Pull-down from the top of a sheet's scroller is the same gesture as
 * dragging the grabber. Anywhere else, the list owns the pointer so a
 * flick through filters never closes the sheet by accident.
 */
export function useSheetOverscroll(
  scrollRef: RefObject<HTMLElement | null>,
  dragControls: DragControls,
  enabled = true,
  expandUp = false,
) {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    let origin: PointerEvent | null = null;
    let claimed = false;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!(e.target instanceof Element)) return;
      if (e.target.closest(OVERSCROLL_IGNORE)) {
        origin = null;
        return;
      }
      if (!expandUp && el.scrollTop > 1) {
        origin = null;
        return;
      }
      origin = e;
      claimed = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!origin || claimed) return;
      if (e.pointerId !== origin.pointerId) return;
      const dy = e.clientY - origin.clientY;
      const dx = e.clientX - origin.clientX;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.1) {
        origin = null;
        return;
      }
      if (expandUp && el.scrollTop <= 1 && dy < -10) {
        claimed = true;
        dragControls.start(origin);
        origin = null;
        return;
      }
      if (dy < -8 || el.scrollTop > 1) {
        origin = null;
        return;
      }
      if (dy > 10 && el.scrollTop <= 0) {
        claimed = true;
        dragControls.start(origin);
        origin = null;
      }
    };

    const onUp = () => {
      origin = null;
      claimed = false;
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragControls, enabled, expandUp, scrollRef]);
}

/** Start a sheet drag unless the press landed on a control. */
export function startSheetDrag(dragControls: DragControls, e: ReactPointerEvent) {
  if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
  dragControls.start(e);
}
