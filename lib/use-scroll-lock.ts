"use client";

import { useEffect } from "react";

// Reference-counted so two overlays open at once (e.g. the search palette on
// top of the assistant) still lock and, crucially, unlock exactly once.
let lockCount = 0;
let savedStyle: string | null = null;
let savedScrollY = 0;

/**
 * Freeze the document while an overlay + keyboard are up.
 *
 * Without this, iOS Safari pans the whole page up to "reveal" the focused
 * field, and that pan stacks on top of the overlay's own keyboard offset —
 * the sheet ends up flung off the top of the screen and the page bottom
 * floats mid-viewport. Pinning `body` (position: fixed at the current scroll
 * offset) leaves nothing for iOS to pan, so the sheet just rises by the
 * keyboard's height and settles cleanly above it. Scroll position is restored
 * when the last lock releases.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const { body } = document;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      savedStyle = body.getAttribute("style");
      body.style.position = "fixed";
      body.style.top = `-${savedScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;
      if (savedStyle === null) body.removeAttribute("style");
      else body.setAttribute("style", savedStyle);
      window.scrollTo(0, savedScrollY);
    };
  }, [active]);
}
