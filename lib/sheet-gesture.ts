"use client";

import { useEffect, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DragControls, PanInfo } from "framer-motion";

/**
 * How far a sheet has to travel before it commits to closing.
 *
 * The old 88px / 700px-per-second bar asked for a committed throw. A real
 * sheet follows the finger and lets go when the gesture *means* dismiss —
 * a short pull with speed, or a longer one without.
 */
export const SHEET_DISMISS = { offset: 52, velocity: 520 } as const;
export const SHEET_EXPAND = { offset: -32, velocity: -460 } as const;

const OVERSCROLL_IGNORE = "input, textarea, select, option, [contenteditable='true']";

export function shouldDismissSheet(info: PanInfo, scale = 1): boolean {
  return info.offset.y > SHEET_DISMISS.offset * scale || info.velocity.y > SHEET_DISMISS.velocity;
}

export function shouldExpandSheet(info: PanInfo): boolean {
  return info.offset.y < SHEET_EXPAND.offset || info.velocity.y < SHEET_EXPAND.velocity;
}

export const SHEET_DRAG = {
  drag: "y" as const,
  dragListener: false as const,
  dragConstraints: { top: 0, bottom: 0 },
  dragElastic: { top: 0.04, bottom: 0.72 },
  dragTransition: { bounceStiffness: 380, bounceDamping: 34 },
};

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
