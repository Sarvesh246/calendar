"use client";

import { animate, motionValue, useMotionValue, type MotionValue } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { haptic } from "@/lib/haptic";
import { VelocityTracker } from "@/lib/gesture";
import { prefersReducedMotion } from "@/lib/motion";
import { skipNextPageEnter } from "@/lib/page-enter";
import { navigateTab } from "@/lib/tab-nav";
import { TAB_ROUTES, type TabRoute } from "@/lib/tab-routes";
import {
  PAGE_SWIPE_AXIS,
  commitPageFromGesture,
  neighbourTab,
  pageSpringForVelocity,
  pageSwipeIgnores,
  rubberbandPageX,
} from "@/lib/tab-swipe";

type Axis = "undecided" | "x" | "y";

/**
 * Where the pager is, in tabs (1.4 = 40% of the way from the second tab to the
 * third), and whether a swipe is driving it. The tab bar's pill follows this
 * while a page is being dragged, so the indicator slides with your thumb and
 * lands with the page instead of jumping once the swipe has finished.
 */
export const pagerPosition = motionValue(0);
export const pagerLive = motionValue(0);

export function useTabPageSwipe(
  hostRef: RefObject<HTMLElement | null>,
  active: TabRoute | null,
  enabled: boolean,
): {
  x: MotionValue<number>;
  peekX: MotionValue<number>;
  trailingX: MotionValue<number>;
  peek: TabRoute | null;
  /** The page a committed swipe just left — kept on screen until it has slid away. */
  trailing: TabRoute | null;
  dragging: boolean;
  /** True while a swipe transform is on the page — including the settle spring. */
  offsetting: boolean;
} {
  const router = useRouter();
  const x = useMotionValue(0);
  const peekX = useMotionValue(0);
  const trailingX = useMotionValue(0);
  const [peek, setPeek] = useState<TabRoute | null>(null);
  const [trailing, setTrailing] = useState<TabRoute | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offsetting, setOffsetting] = useState(false);
  const axis = useRef<Axis>("undecided");
  const start = useRef({ x: 0, y: 0 });
  const tracker = useRef(new VelocityTracker());
  const pointerId = useRef<number | null>(null);
  /** Index of the page `x` is currently moving (changes at commit). */
  const boundIndex = useRef(0);
  /** Which way the trailing page sits from the active one (−1 left, +1 right). */
  const trailingSide = useRef(0);
  const width = useRef(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const unsubscribe = x.on("change", (v) => {
      const w = width.current;
      if (w > 0) {
        pagerPosition.set(boundIndex.current - v / w);
        trailingX.set(v + trailingSide.current * w);
      }
    });
    return unsubscribe;
  }, [x, trailingX]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled || !active) return;

    const widthOf = () => host.getBoundingClientRect().width || window.innerWidth;

    const reset = () => {
      axis.current = "undecided";
      pointerId.current = null;
      setDragging(false);
    };

    const settleDone = () => {
      setOffsetting(false);
      setTrailing(null);
      pagerLive.set(0);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (document.documentElement.classList.contains("scroll-locked")) return;
      if (pageSwipeIgnores(e.target)) return;
      pointerId.current = e.pointerId;
      axis.current = "undecided";
      start.current = { x: e.clientX, y: e.clientY };
      tracker.current.reset(e.clientX, e.timeStamp);
    };

    const onMove = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      const index = TAB_ROUTES.indexOf(active);
      if (index < 0) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      tracker.current.add(e.clientX, e.timeStamp);

      if (axis.current === "undecided") {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx < PAGE_SWIPE_AXIS && ady < PAGE_SWIPE_AXIS) return;
        if (ady > adx * 1.15) {
          axis.current = "y";
          return;
        }
        if (adx > ady * 1.15) {
          axis.current = "x";
          // Catch a page that is still settling from the last swipe: grab it
          // where it is rather than letting it jump home first.
          x.stop();
          width.current = widthOf();
          boundIndex.current = index;
          trailingSide.current = 0;
          setTrailing(null);
          pagerLive.set(1);
          setDragging(true);
          setOffsetting(true);
          host.setPointerCapture?.(e.pointerId);
          // Measure from here so the page doesn't jump by the axis slop.
          start.current = { x: e.clientX - (x.get() || 0), y: e.clientY };
        } else {
          return;
        }
      }
      if (axis.current !== "x") return;
      if (e.cancelable) e.preventDefault();

      const w = width.current || widthOf();
      const drag = e.clientX - start.current.x;
      const visual = rubberbandPageX(drag, index, TAB_ROUTES.length, w);
      x.set(visual);
      setPeek(neighbourTab(index, drag));
      peekX.set(visual + (drag >= 0 ? -w : w));
    };

    const finish = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      const locked = axis.current;
      const index = TAB_ROUTES.indexOf(active);
      const dx = e.clientX - start.current.x;
      const vx = tracker.current.velocity(e.timeStamp);
      reset();
      if (host.hasPointerCapture?.(e.pointerId)) host.releasePointerCapture(e.pointerId);
      if (locked !== "x" || index < 0) return;

      const w = width.current || widthOf();
      const nextIndex = commitPageFromGesture({
        startIndex: index,
        dx,
        vx,
        width: w,
        count: TAB_ROUTES.length,
      });
      const to = TAB_ROUTES[nextIndex];
      const spring = pageSpringForVelocity(vx);

      const swallowClick = () => {
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        window.addEventListener("click", swallow, true);
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 420);
      };

      if (nextIndex === index) {
        if (reduced) {
          x.set(0);
          peekX.set(0);
          setPeek(null);
          settleDone();
          return;
        }
        void animate(x, 0, spring).then(settleDone);
        const home = x.get() >= 0 ? -w : w;
        void animate(peekX, home, spring).then(() => setPeek(null));
        return;
      }

      swallowClick();
      haptic("selection");
      skipNextPageEnter();
      if (reduced) {
        x.set(0);
        peekX.set(0);
        setPeek(null);
        settleDone();
        navigateTab(router, to);
        return;
      }
      // Re-centre on the incoming page: it keeps exactly the offset it had as
      // the peek, the page you left becomes the trailing one beside it, and
      // both ride the same spring home together.
      const dir = nextIndex - index;
      const remaining = x.get() + dir * w;
      boundIndex.current = nextIndex;
      trailingSide.current = -dir;
      setTrailing(active);
      setPeek(null);
      navigateTab(router, to);
      x.set(remaining);
      void animate(x, 0, spring).then(settleDone);
    };

    host.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    const onTouchMove = (e: TouchEvent) => {
      if (axis.current === "x" && e.cancelable) e.preventDefault();
    };
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      host.removeEventListener("touchmove", onTouchMove);
    };
  }, [active, enabled, hostRef, peekX, reduced, router, x]);

  return { x, peekX, trailingX, peek, trailing, dragging, offsetting };
}
