"use client";

import { useEffect } from "react";

/**
 * Lock page scroll while a sheet/dialog is open. Overflow-hidden on both html
 * and body is enough with `interactiveWidget: overlays-content`; we skip
 * position:fixed (it jumps the page and fights iOS's visual viewport).
 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    html.classList.add("scroll-locked");
    return () => html.classList.remove("scroll-locked");
  }, [locked]);
}
