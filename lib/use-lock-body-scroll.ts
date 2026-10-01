"use client";

import { useEffect } from "react";

/**
 * Lock page scroll while a sheet/dialog is open.
 *
 * Reference-counted: with two overlays open at once (a day sheet with the
 * filter sheet over it), closing the top one used to unlock the page underneath
 * the one still on screen.
 *
 * Two strategies, by input type:
 *
 * - Touch (phones, the IPA): `overflow: hidden` on html and body — iOS needs
 *   it, and with `interactiveWidget: overlays-content` it is enough. We skip
 *   `position: fixed` (it jumps the page and fights iOS's visual viewport).
 *
 * - Mouse/trackpad (desktop): no style change at all. Flipping the root's
 *   overflow re-lays out the entire document, on open *and* on close — ~100ms
 *   on a big Agenda, which is why search, filters and every sheet opened with a
 *   hitch. Instead, wheel events that would end up scrolling the page are
 *   cancelled; wheel inside the overlay's own scrollable areas works as usual.
 *   `scrollbar-gutter: stable` already keeps the layout still either way.
 *
 * `scroll-locked` stays on the root in both cases — it's a style hook (the save
 * pill hides under sheets), not the mechanism.
 */
let locks = 0;
let detachWheel: (() => void) | null = null;

function isFinePointer() {
  return window.matchMedia("(pointer: fine)").matches;
}

/** Can `el` itself scroll further in the direction of `dy`? */
function canScroll(el: HTMLElement, dy: number) {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") return false;
  return dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey) return; // pinch-zoom
  const dy = e.deltaY;
  if (dy === 0) return;
  const root = document.scrollingElement;
  for (let node = e.target as HTMLElement | null; node && node !== document.body && node !== root; node = node.parentElement) {
    // Something inside the overlay will take this scroll — let it.
    if (canScroll(node, dy)) return;
  }
  // Otherwise the wheel would chain to the page behind the overlay.
  e.preventDefault();
}

export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    locks += 1;
    if (locks === 1) {
      html.classList.add("scroll-locked");
      if (isFinePointer()) {
        window.addEventListener("wheel", onWheel, { passive: false });
        detachWheel = () => window.removeEventListener("wheel", onWheel);
      } else {
        html.classList.add("scroll-locked-overflow");
      }
    }
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks > 0) return;
      html.classList.remove("scroll-locked", "scroll-locked-overflow");
      detachWheel?.();
      detachWheel = null;
    };
  }, [locked]);
}
