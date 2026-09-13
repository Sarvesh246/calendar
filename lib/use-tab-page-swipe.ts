"use client";

import { animate, useMotionValue, type MotionValue } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { haptic } from "@/lib/haptic";
import { prefersReducedMotion } from "@/lib/motion";
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

export function useTabPageSwipe(
  hostRef: RefObject<HTMLElement | null>,
  active: TabRoute | null,
  enabled: boolean,
): {
  x: MotionValue<number>;
  peekX: MotionValue<number>;
  peek: TabRoute | null;
  dragging: boolean;
} {
  const router = useRouter();
  const x = useMotionValue(0);
  const peekX = useMotionValue(0);
  const [peek, setPeek] = useState<TabRoute | null>(null);
  const [dragging, setDragging] = useState(false);
  const axis = useRef<Axis>("undecided");
  const start = useRef({ x: 0, y: 0, t: 0 });
  const last = useRef({ x: 0, t: 0 });
  const velocity = useRef(0);
  const pointerId = useRef<number | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled || !active) return;

    const widthOf = () => host.getBoundingClientRect().width || window.innerWidth;

    const reset = () => {
      axis.current = "undecided";
      pointerId.current = null;
      setDragging(false);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (document.documentElement.classList.contains("scroll-locked")) return;
      if (pageSwipeIgnores(e.target)) return;
      pointerId.current = e.pointerId;
      axis.current = "undecided";
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      last.current = { x: e.clientX, t: e.timeStamp };
      velocity.current = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      const index = TAB_ROUTES.indexOf(active);
      if (index < 0) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      const dt = e.timeStamp - last.current.t;
      if (dt > 0 && dt < 64) velocity.current = ((e.clientX - last.current.x) / dt) * 1000;
      else if (dt >= 64) velocity.current = 0;
      last.current = { x: e.clientX, t: e.timeStamp };

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
          setDragging(true);
          host.setPointerCapture?.(e.pointerId);
        } else {
          return;
        }
      }
      if (axis.current !== "x") return;
      if (e.cancelable) e.preventDefault();

      const visual = rubberbandPageX(dx, index, TAB_ROUTES.length);
      x.set(visual);
      const next = neighbourTab(index, dx);
      setPeek(next);
      const width = widthOf();
      peekX.set(visual + (dx >= 0 ? -width : width));
    };

    const finish = (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      const locked = axis.current;
      const index = TAB_ROUTES.indexOf(active);
      const dx = e.clientX - start.current.x;
      const vx = velocity.current;
      reset();
      if (host.hasPointerCapture?.(e.pointerId)) host.releasePointerCapture(e.pointerId);
      if (locked !== "x" || index < 0) {
        x.set(0);
        setPeek(null);
        return;
      }

      const width = widthOf();
      const nextIndex = commitPageFromGesture({
        startIndex: index,
        dx,
        vx,
        width,
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
          return;
        }
        void animate(x, 0, spring);
        const home = dx >= 0 ? -width : width;
        void animate(peekX, home, spring).then(() => setPeek(null));
        return;
      }

      swallowClick();
      haptic("light");
      if (reduced) {
        x.set(0);
        peekX.set(0);
        setPeek(null);
        navigateTab(router, to);
        return;
      }
      const remaining = rubberbandPageX(dx, index, TAB_ROUTES.length) + (dx >= 0 ? -width : width);
      navigateTab(router, to);
      x.set(remaining);
      setPeek(null);
      void animate(x, 0, spring);
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

  return { x, peekX, peek, dragging };
}
