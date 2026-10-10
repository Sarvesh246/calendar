"use client";

import { animate, useDragControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { haptic } from "@/lib/haptic";
import { sheetRelease } from "@/lib/sheet-gesture";
import { motion as motionTokens, prefersReducedMotion, releaseSpring } from "@/lib/motion";

/**
 * Every bottom sheet's physics, in one place.
 *
 *  - It sits under the finger: 1:1 going down (the direction it's allowed to
 *    go), a firm rubber-band going up past the top detent.
 *  - Release is judged by where the sheet would coast to (`project`), so a
 *    short flick and a long slow pull are read on the same scale, and a pull
 *    that is heading back up when you let go stays.
 *  - Whatever happens next — closing, landing on a detent, springing home —
 *    starts at the speed your finger left it. Nothing "catches" at release.
 *  - The scrim is a function of where the sheet is, so pulling a sheet halfway
 *    down uncovers the page halfway.
 */

const OPEN = motionTokens.settle;

export interface SheetPhysicsOptions {
  panelRef: RefObject<HTMLElement | null>;
  /** Called once the sheet has fully left the screen. */
  onClosed: () => void;
  /** Return false to veto a close (unsaved changes that failed to save). */
  canClose?: () => boolean;
  /** Resting offsets from fully open, in px, top first. Default: one detent at 0. */
  detents?: () => number[];
  /** Detent to open at (index into `detents`). */
  initialDetent?: number;
  onDetent?: (index: number) => void;
}

export function useSheetPhysics({
  panelRef,
  onClosed,
  canClose,
  detents,
  initialDetent = 0,
  onDetent,
}: SheetPhysicsOptions) {
  const dragControls = useDragControls();
  // Parked far below until the first layout pass has measured the sheet.
  const y = useMotionValue(4000);
  const [dragging, setDragging] = useState(false);
  const [gone, setGone] = useState(false);
  const closing = useRef(false);
  const detentIndex = useRef(initialDetent);
  const reduced = prefersReducedMotion();

  const heightOf = useCallback(() => panelRef.current?.offsetHeight || window.innerHeight * 0.6, [panelRef]);
  const pointsOf = useCallback(() => (detents ? detents() : [0]), [detents]);

  const scrimOpacity = useTransform(y, (v) => {
    const h = panelRef.current?.offsetHeight || 1;
    return Math.max(0, Math.min(1, 1 - v / h));
  });

  // Rise from just below the screen. Layout effect: the sheet is measured and
  // placed before the first paint, so it never flashes at its resting spot.
  // Runs after every commit until the panel exists (a sheet may render nothing
  // on its first pass while it works out whether it is visible), then once.
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (entered.current || !panelRef.current) return;
    entered.current = true;
    const target = pointsOf()[initialDetent] ?? 0;
    if (reduced) {
      y.set(target);
      return;
    }
    y.set(heightOf());
    void animate(y, target, OPEN);
  });

  const finish = useCallback(() => {
    // Re-render first so a fallback `exit` (AnimatePresence) becomes a no-op,
    // then hand over — the sheet is already off screen.
    setGone(true);
    requestAnimationFrame(() => onClosed());
  }, [onClosed]);

  const snapTo = useCallback(
    (index: number, velocity = 0) => {
      const points = pointsOf();
      const target = points[Math.max(0, Math.min(points.length - 1, index))];
      if (index !== detentIndex.current) {
        detentIndex.current = index;
        onDetent?.(index);
      }
      if (reduced) {
        y.set(target);
        return;
      }
      void animate(y, target, releaseSpring(velocity, 0.86, 0.42));
    },
    [onDetent, pointsOf, reduced, y]
  );

  /** Slide the sheet away (carrying `velocity`, px/s) and then call `onClosed`. */
  const close = useCallback(
    (velocity = 0) => {
      if (closing.current) return;
      if (canClose && !canClose()) {
        snapTo(detentIndex.current, velocity);
        return;
      }
      closing.current = true;
      if (reduced) {
        finish();
        return;
      }
      const h = heightOf();
      void animate(y, h + 24, {
        ...releaseSpring(Math.max(0, velocity), 1, 0.36),
        restDelta: 2,
        restSpeed: 40,
      }).then(finish);
    },
    [canClose, finish, heightOf, reduced, snapTo, y]
  );

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      setDragging(false);
      const points = pointsOf();
      const v = info.velocity.y;
      const release = sheetRelease({ at: y.get(), velocity: v, height: heightOf(), points });
      if (release.kind === "close") {
        haptic("light");
        close(v);
        return;
      }
      if (release.index !== detentIndex.current) haptic("light");
      snapTo(release.index, v);
    },
    [close, heightOf, pointsOf, snapTo, y]
  );

  const dragProps = {
    drag: "y" as const,
    dragListener: false as const,
    dragControls,
    // Past the top detent it resists; everything below follows the finger
    // 1:1 (an elastic of 1 is no resistance at all), so the bottom bound
    // never matters while dragging. The release is ours, not Framer's.
    dragConstraints: { top: 0, bottom: 0 },
    dragElastic: { top: 0.12, bottom: 1 },
    dragMomentum: false,
    onDragStart: () => setDragging(true),
    onDragEnd,
    style: { y, willChange: "transform" as const },
  };

  return { y, scrimOpacity, dragging, dragControls, dragProps, close, snapTo, gone, closing };
}
