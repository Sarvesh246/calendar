"use client";

import { useEffect } from "react";

/**
 * Lock page scroll while a sheet/dialog is open. Overflow-hidden on both html
 * and body is enough with `interactiveWidget: overlays-content`; we skip
 * position:fixed (it jumps the page and fights iOS's visual viewport).
 *
 * Reference-counted: with two overlays open at once (a day sheet with the
 * filter sheet over it), closing the top one used to unlock the page underneath
 * the one still on screen.
 */
let locks = 0;

export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    locks += 1;
    html.classList.add("scroll-locked");
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) html.classList.remove("scroll-locked");
    };
  }, [locked]);
}
