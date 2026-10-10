"use client";

import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion, springEasing, supportsLinearEasing } from "./motion";

let timing: { easing: string; duration: number } | null = null;
/** Critically damped: a disclosure that bounced would bounce the whole page. */
function collapseTiming() {
  if (!timing) {
    timing = supportsLinearEasing()
      ? springEasing(0.36, 1, 24)
      : { easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", duration: 320 };
  }
  return timing;
}

/**
 * Open and close a block to its real height on a spring.
 *
 * CSS can't transition between `0` and `auto` (or between `0fr` and
 * `max-content` grid tracks — that pair interpolates *discretely*, which is
 * how Settings cards used to sit still for half the duration and then snap),
 * so this measures the two heights and runs a WAAPI animation between them on
 * the same spring the rest of the app uses. At rest the element's height is
 * plain `auto` or `0px`, so content that grows later is never clipped.
 * Reversing mid-flight starts from wherever the block currently is.
 */
export function useAnimatedCollapse<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);
  const mountedAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = performance.now();
    if (mountedAt.current === null) {
      mountedAt.current = now;
      el.style.height = open ? "auto" : "0px";
      return;
    }
    // A remembered state arriving just after hydration is a restore, not
    // something the reader did — put it in place without animating.
    if (now - mountedAt.current < 300) {
      el.getAnimations().forEach((a) => a.cancel());
      el.style.height = open ? "auto" : "0px";
      return;
    }
    const from = el.getBoundingClientRect().height;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.height = open ? "auto" : "0px";
    const to = open ? el.getBoundingClientRect().height : 0;
    if (prefersReducedMotion() || Math.abs(to - from) < 1) return;
    const { easing, duration } = collapseTiming();
    el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing });
  }, [open]);

  return ref;
}
