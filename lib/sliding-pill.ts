"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";

/**
 * The selected-segment highlight shared by every segmented control, tab strip
 * and picker: one pill per control that slides to the chosen option.
 *
 * Why not framer's `layoutId`: a shared-layout element measures the DOM on
 * every commit it takes part in and then animates on the main thread. The
 * click that moves it is also the click that starts the expensive render (a
 * new month, a new layout, a reveal), so the spring sat frozen for exactly the
 * frames you were watching — the stutter every control had.
 *
 * Here the move is a FLIP on `transform` through the Web Animations API, which
 * the compositor runs by itself. `moveTo` is called straight from the click
 * handler — before React has committed anything — so the pill is already
 * gliding while the page catches up. The option's ink flips at the same moment
 * via `data-pill-on`, instead of a commit later.
 *
 * Usage:
 *   const pill = useSlidingPill(activeKey);
 *   <div ref={pill.containerRef} className="relative …">
 *     <span ref={pill.pillRef} aria-hidden className="sliding-pill rounded-md bg-accent" />
 *     <button data-pill-key="a" onClick={(e) => { pill.moveTo(e.currentTarget); … }}
 *       className="… data-[pill-on]:text-accent-ink">
 */

/** iOS-like ease-out: quick to leave, long settle. */
export const PILL_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const PILL_MS = 340;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `el`'s box in `container`'s coordinates, through any nested offset parents. */
function boxOf(el: HTMLElement, container: HTMLElement | null): Box {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export interface SlidingPillOptions {
  /** Attribute naming each option. Lets two pills share one container. */
  keyAttr?: string;
  /** Set `data-pill-on` on the chosen option (for its ink). Default true. */
  mark?: boolean;
  /** Use another pill's container (two pills in one control). */
  container?: RefObject<HTMLElement | null>;
}

function place(pill: HTMLElement, box: Box) {
  pill.style.width = `${box.w}px`;
  pill.style.height = `${box.h}px`;
  pill.style.transform = `translate(${box.x}px, ${box.y}px)`;
  pill.style.opacity = "1";
}

export function markOn(target: HTMLElement, container: HTMLElement | null) {
  container?.querySelectorAll("[data-pill-on]").forEach((el) => {
    if (el !== target) el.removeAttribute("data-pill-on");
  });
  target.setAttribute("data-pill-on", "");
}

export function useSlidingPill<C extends HTMLElement = HTMLDivElement, P extends HTMLElement = HTMLSpanElement>(
  activeKey: string | null | undefined,
  { keyAttr = "data-pill-key", mark = true, container: shared }: SlidingPillOptions = {}
) {
  const containerRef = useRef<C>(null);
  // Resolved at call time, so a shared container needs no extra dependency.
  const getContainer = useCallback(
    (): HTMLElement | null => (shared ? shared.current : containerRef.current),
    [shared]
  );
  const pillRef = useRef<P>(null);
  const current = useRef<Box | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const anim = useRef<Animation | null>(null);

  const slideTo = useCallback(
    (el: HTMLElement, animate: boolean) => {
      const pill = pillRef.current;
      if (!pill) return;
      const to = boxOf(el, getContainer());
      const from = current.current;
      target.current = el;
      if (mark) markOn(el, getContainer());
      if (from && from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return;
      // Continue from wherever an in-flight slide has got to, not its target.
      let start = from;
      if (anim.current && from && anim.current.playState === "running") {
        const m = new DOMMatrixReadOnly(getComputedStyle(pill).transform);
        const r = pill.getBoundingClientRect();
        start = { x: m.m41, y: m.m42, w: r.width, h: r.height };
      }
      anim.current?.cancel();
      anim.current = null;
      place(pill, to);
      current.current = to;
      if (!animate || !start || prefersReducedMotion()) return;
      const sx = start.w / (to.w || 1);
      const sy = start.h / (to.h || 1);
      anim.current = pill.animate(
        [
          { transform: `translate(${start.x}px, ${start.y}px) scale(${sx}, ${sy})` },
          { transform: `translate(${to.x}px, ${to.y}px)` },
        ],
        { duration: PILL_MS, easing: PILL_EASE }
      );
    },
    [mark, getContainer]
  );

  /** Call from the option's click handler, before any state update. */
  const moveTo = useCallback((el: HTMLElement) => slideTo(el, true), [slideTo]);

  // Follow state: keyboard, store changes, restores. After a click this is a
  // no-op because `moveTo` already put the pill there.
  useLayoutEffect(() => {
    const container = getContainer();
    const pill = pillRef.current;
    if (!container || !pill) return;
    const el =
      activeKey == null
        ? null
        : container.querySelector<HTMLElement>(`[${keyAttr}="${CSS.escape(activeKey)}"]`);
    if (!el) {
      pill.style.opacity = "0";
      current.current = null;
      target.current = null;
      if (mark) container.querySelectorAll("[data-pill-on]").forEach((n) => n.removeAttribute("data-pill-on"));
      return;
    }
    slideTo(el, current.current !== null);
  }, [activeKey, keyAttr, mark, slideTo, getContainer]);

  // Re-seat without animating when the control itself changes size (window
  // resize, font scale, the rail collapsing). Reads happen in the observer
  // callback, after layout, so this never forces one.
  useLayoutEffect(() => {
    const container = getContainer();
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = target.current;
      const pill = pillRef.current;
      if (!el || !pill || !el.isConnected || anim.current?.playState === "running") return;
      const box = boxOf(el, container);
      const cur = current.current;
      if (cur && cur.x === box.x && cur.y === box.y && cur.w === box.w && cur.h === box.h) return;
      place(pill, box);
      current.current = box;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [getContainer]);

  return { containerRef, pillRef, moveTo };
}
